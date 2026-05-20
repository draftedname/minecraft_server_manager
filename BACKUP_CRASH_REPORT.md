# Backup Button & Crash Fixes — Complete Timeline

## Overview

When backing up a Minecraft world while the server is running, Java holds exclusive locks on region files (`.mca`). Any attempt to read those files — by archiver, by Node's `fs`, or by native zip libraries — triggers errors ranging from `EBUSY` exceptions to full native process crashes. This document traces every attempt made to handle these failures and the final solution that works.

---

## Issue 1: Local Backup Returns 500 on Running Server

**Symptom:** Clicking the Local backup button while the server is running shows a red toast: "Backup failed — Request failed with status code 500". The backup zip is created but the button stays grayed out.

**Root cause:** The local backup route used `archive.directory()` directly on the live world directory. When archiver hit a file locked by Java, it threw `EBUSY` which propagated as a 500 error.

**Fix #1 — EBUSY handler:** Modified the archive error handler to ignore `EBUSY`:
```ts
archive.on("error", (err) => {
    if (err.code !== "EBUSY") reject(err);
});
archive.finalize();
```

**Result:** The error was suppressed but the output stream never closed — `close` event didn't fire because archiver's internal `directory()` doesn't call `finalize()` on error. Promise hung forever. Button stayed disabled.

---

## Issue 2: Archive Never Closes After EBUSY

**Symptom:** After Fix #1, the local backup button stays permanently grayed out with the loading spinner. The request never completes.

**Root cause:** When `archive.directory()` encounters EBUSY, it emits `error` but does NOT call `finalize()`. The output stream remains open and the `close` event never fires. The Promise constructor's `output.on("close", resolve)` never resolves.

**Fix #2 — Manual finalize on EBUSY:** Called `archive.finalize()` in the error handler:
```ts
archive.on("error", (err) => {
    if (err.code === "EBUSY") {
        archive.finalize();  // force close to flush partial backup
    } else {
        reject(err);
    }
});
```

**Result:** `ArchiverError: archive already finalizing`. Archiver internally calls `finalize()` first, then emits the error. Our second call triggers a synchronous exception that kills the backend process.

---

## Issue 3: Double finalize() Crashes Backend

**Symptom:** Backend process crashes with:
```
ArchiverError: archive already finalizing
    at Archiver.finalize (core.js:778)
    at world.ts:116 (our handler)
    at Archiver._finalize (core.js:188)    ← internal call
```

**Root cause:** Archiver's `directory()` implementation calls `archive.finalize()` internally when walking completes OR when an error occurs. Our error handler was calling it a second time. Archiver rejects duplicate `finalize()` calls with a fatal exception.

**Fix #3 — Don't call finalize; archiver does it:** Reverted to ignoring EBUSY:
```ts
archive.on("error", (err) => {
    if (err.code === "EBUSY") return;
    reject(err);
});
archive.finalize();
```

**Result:** Same as Fix #1 — `close` event never fires because archiver's internal `finalize()` fires before the error, creating a race condition where the error handler sees the emitted event but the stream is already in a bad state.

---

## Issue 4: Native Crash (0xC0000409) — STATUS_STACK_BUFFER_OVERRUN

**Symptom:** Backend process crashes with exit code `3221226505` (`0xC0000409`). The entire `@mcservergui/server#dev` process dies. No JavaScript error is caught — this is a native crash inside the C++ zip compression library.

**Root cause:** Archiver uses `compress-commons` which uses Node's native `zlib` bindings. When `archive.directory()` tries to `createReadStream` on a file exclusively locked by Java, the native zip library encounters a situation it cannot handle. The error propagates as a stack buffer overrun in the native C++ layer — bypassing Node's `try/catch` and `process.on('uncaughtException')` entirely.

The EBUSY error handler at the JS level is irrelevant — the crash happens deep in the native call stack before the JS error even fires.

---

## Issue 5: readFileSync EBUSY

**Symptom:** Same 500 error when using `readFileSync` in the `copyReadable` function (used by the Drive backup two-phase copy).

**Root cause:** `readFileSync` throws `EBUSY` immediately when a file is locked. The try-catch in `copyReadable` handles this correctly — but the Drive backup route wasn't passing `isRunning`, so `copyReadable` was never called. The route always used the direct `archive.directory()` path.

**Fix:** Added `getRunningServer(serverId)` to `drive.ts` to detect running servers and pass `isRunning` to `backupWorldToDrive()`.

---

## Issue 6: Missing Drive Backup List Refresh

**Symptom:** After a successful Drive backup, the Drive Backups list doesn't update until the user switches tabs and returns.

**Root cause:** `driveBackupMutation.onSuccess` showed a toast but never called `queryClient.invalidateQueries()` for the drive backups query key.

**Fix:** Added:
```ts
queryClient.invalidateQueries({ queryKey: ["drive", "backups", server?.config.name] });
```

---

## Issue 7: Concurrent Backup Collision

**Symptom:** Theoretical race condition — if a cron backup and manual backup run simultaneously for the same server, both use the same temp directory name `.tmp-${serverId}`.

**Root cause:** Static temp directory name based only on server ID.

**Fix:** Appended the timestamp to the temp directory name: `.tmp-${serverId}-${timestamp}`.

---

## Issue 8: Sync copyReadable Causes Event Loop Starvation

**Symptom:** During live backups on large worlds, the backend freezes — socket.io heartbeats timeout, API stops responding.

**Root cause:** The original `copyReadable` used synchronous `readdirSync` and `readFileSync` in a tight loop over every file in the world directory.

**Fix:** Rewrote `copyReadable` using `fs/promises` (`readdir`, `readFile`, `writeFile`) with an 8-worker concurrency pool. Each `await` yields to the event loop.

---

## Final Solution: Universal Two-Phase Backup

**Approach:** No longer use `archive.directory()` on a live world under any circumstances. Both local and Drive backups now use the same two-phase strategy when the server is running:

```
Phase 1 — copyReadable(src, tempDir)
  ├── Walk world directory with async readdir (yields event loop)
  ├── For each file: readFile (try-catch EBUSY → skip if locked)
  ├── Write readable files to temp directory
  └── 8-worker concurrency pool prevents I/O starvation

Phase 2 — archive.directory(tempDir, worldName)
  ├── All files in temp dir are readable (no locks)
  ├── Safe for archive.directory() to zip directly
  └── No EBUSY, no native crashes, no FINALIZING errors

Phase 3 — Cleanup
  └── rmSync(tempDir) in finally block
```

When the server is **stopped**, `archive.directory()` zips the world directly (fast path — no locked files).

**File changes:**

| File | Change |
|------|--------|
| `routes/worlds.ts` | Local backup now uses `copyReadable` + temp dir when isRunning |
| `services/BackupScheduler.ts` | Drive/scheduled backup uses shared `copyReadable` |
| `services/FileUtils.ts` | Centralized `copyReadable` + `copyDirAsync` async utilities |
| `routes/drive.ts` | Added `getRunningServer` to pass `isRunning` |
| `client/pages/Worlds.tsx` | Drive list refresh after upload, restore buttons, delete Drive button |

---

## Summary of All Attempts

| Attempt | Approach | Result |
|---------|----------|--------|
| 1 | Ignore EBUSY in archiver error handler | Promise hangs — close never fires |
| 2 | manual `archive.finalize()` on EBUSY | `FINALIZING` error — archiver already finalizes |
| 3 | Don't finalize, rely on internal | Promise hangs — race condition |
| 4 | `readFileSync` try-catch | 500 error — route didn't pass `isRunning` |
| 5 | `createReadStream` with error listener | EBUSY fires before listener attached |
| 6 | Sync `copyReadable` with worker pool | Event loop starvation on large worlds |
| **7** | **Two-phase copy (async) for all running-server backups** | **Works** |
