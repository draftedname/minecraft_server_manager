# Implementation Report — All Phases

## Phase 1: Stabilization & Critical Fixes

---

### Fix 1: Automated Backups Were Skipping Running Servers

**File:** `apps\server\src\services\BackupScheduler.ts`

**Original Bug:**
```ts
if (existsSync(path.join(fullPath, "session.lock"))) continue;
```
The scheduler checked for `session.lock` and skipped the entire world if found. Since Minecraft holds `session.lock` from server start until shutdown, automated backups ran exclusively on stopped servers — making the entire cron system useless for production.

**Attempt 1 — `archive.glob()`:** Replaced the skip with `archive.glob("**/*", { ignore: ["session.lock", "*.lock"] })` to exclude lock files while archiving everything else.

> **Result:** Crashed with `EBUSY: resource busy or locked, read`. The glob pattern excluded lock files, but Minecraft also exclusively locks `.mca` region files on Windows. Archiver's error event stops the entire zip — not recoverable.

**Attempt 2 — `createReadStream` with event handler:** Wrapped per-file reads with `readStream.on("error", ...)` to catch `EBUSY` and skip silently.

> **Result:** Still crashed. `createReadStream` fires its `error` event asynchronously, and the `readStream.pipe(writeStream)` sometimes triggered before the listener was attached, causing an unhandled exception.

**Attempt 3 — `readFileSync` try-catch:** Used `readFileSync` inside a try-catch, skipping `EBUSY`/`EACCES`/`EPERM` errors.

> **Result:** Same error returned to the user. Investigation revealed the Drive backup route (`POST /drive/backup`) was calling `backupWorldToDrive()` without the `isRunning` parameter, so it always defaulted to `false` and used the direct archiver path.

**Attempt 4 — Missing `isRunning` on manual backup:** Added `getRunningServer(serverId)` check in the drive route to pass the correct `isRunning` flag.

> **Result:** EBUSY error persisted. The `copyReadable` function was synchronous (`readdirSync` + `readFileSync`), which could cause event loop starvation on large worlds — but the actual crash was still EBUSY.

**Attempt 5 — `readFileSync` cannot skip locked files on Windows:** On Windows, `readFileSync` throws `EBUSY` immediately when a file is exclusively locked by another process (Java). The try-catch should handle this, but the error was still propagating as unhandled in certain cases.

**Final Fix — Two-Phase Copy (synchronous):** For live backups:
1. **Phase 1 — `copyReadable()`:** Walks the world directory with `readdirSync`. For each file, attempts `readFileSync()` inside a try-catch. If `EBUSY`/`EACCES`/`EPERM`, the file is silently skipped. Lock files are also skipped. All successfully read files are written to a temp directory.
2. **Phase 2:** `archive.directory()` zips the temp directory (no locked files exist there). Temp is cleaned up in a `finally` block.

For stopped servers, the original direct `archive.directory()` is used (no temp copy).

**Bonus Fix — Async copyReadable (post-review):** The architectural review noted that `copyReadable` used synchronous `readdirSync` and `readFileSync`, which could cause event loop starvation on gigabyte-scale worlds (the same issue we eradicated in Fix 2). Converted to fully async using `fs/promises` (`readdir`, `readFile`, `writeFile`) with an 8-worker concurrency pool — matching the pattern from `copyDirAsync`.

**Files changed:**
- `apps\server\src\services\BackupScheduler.ts` — `copyReadable` rewritten async with worker pool, `isRunning` parameter flow fixed, unused sync imports cleaned
- `apps\server\src\routes\drive.ts` — added `getRunningServer` import and `isRunning` propagation to `backupWorldToDrive`
- Import cleanups

---

### Fix 2: Event Loop Starvation During Modpack Overrides Copy

**Files:** `apps\server\src\routes\servers.ts`, `apps\server\src\routes\modpacks.ts`
**New file:** `apps\server\src\services\FileUtils.ts`

**Original Bug:**

Two recursive synchronous copy functions running inside Express request handlers:
- `servers.ts:170-184` — inline `copyDir()` with `readdirSync` + `copyFileSync`
- `modpacks.ts:135-147` — `copyDirSync()` with the same pattern

For modpacks with hundreds of config files and nested asset folders, these block Node's single thread for seconds. Socket.io heartbeats time out, all API endpoints freeze, clients disconnect.

**Fix:**

Created `apps\server\src\services\FileUtils.ts` with an async `copyDirAsync()` function:

```ts
export async function copyDirAsync(
  src: string,
  dest: string,
  concurrency: number = 8
): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  const queue = [...entries];
  const worker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      // mkdir (async) + copyFile (async)
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
```

Each `await` yields control to the event loop. An 8-worker pool parallelizes file copies while keeping I/O throttled.

Both `servers.ts` and `modpacks.ts` now import and use `copyDirAsync`. The old synchronous `copyDirSync` was removed from `modpacks.ts`. Unused `readdirSync` and `copyFileSync` imports were cleaned from `servers.ts`.

---

### Fix 3: Shell Injection via `shell: true`

**File:** `apps\server\src\services\ServerManager.ts`

**Original Bug:**

All three `child_process.spawn` calls passed `shell: true`, meaning the arguments array was joined and passed through `cmd.exe` (Windows) or `/bin/sh` (Linux). If any argument contained backticks, `&&`, `;`, or `$()`, the shell would interpret them before Java ran.

Primary vectors:
- `config.javaPath` — user-modifiable server config
- Fabric classpath string — from `fabric-profile.json`

**Fix:**

Removed `shell: true` from all three spawn calls. `child_process.spawn` now passes each array element as a direct `argv` entry to `java.exe`, with zero shell interpretation:

```ts
const proc = spawn(javaPath, args, {
  cwd: serverDir,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,  // works without shell
});
```

`windowsHide: true` alone sets `CREATE_NO_WINDOW` on Windows — no shell needed to suppress the console.

---

## Phase 2: New Features

---

### Feature 1: Transactional World Restoration

**New file:** `apps\server\src\services\WorldRestoreService.ts`
**Updated:** `apps\server\src\routes\worlds.ts`, frontend `Worlds.tsx`

**Pipeline (with rollback at every failure point):**

```
1. Verify server stopped          → error if running
2. Rename world → world.backup.{timestamp}
3. Extract backup zip into world  → on failure: delete world, rename backup back
4. Verify level.dat exists        → on failure: same rollback
5. Delete backup, return success
```

**Key detail — Zip entry prefix issue:** The backup zip was created with `archive.directory(worldPath, worldName)`, which prefixes all entries with `world/`. The restore was extracting to `serverDir/world/`, creating a nested `serverDir/world/world/level.dat`. Fixed by extracting to `serverDir` so the prefix maps correctly.

**Routes added:**
- `POST /servers/:id/worlds/restore` — restore from local backup zip
- `POST /servers/:id/worlds/restore-drive` — download from Drive, then restore

**UI:** Restore button (RotateCcw icon) on every local backup and Drive backup entry.

---

### Feature 2: Chunked Streaming Uploads

**New files:** `apps\server\src\routes\upload.ts`, `apps\client\src\hooks\useChunkedUpload.ts`, `apps\client\src\components\ui\progress.tsx`
**Updated:** `apps\server\src\index.ts`, frontend `Files.tsx`

**Architecture:**

| Layer | Component |
|-------|-----------|
| Backend | `POST /upload/init` — creates session, returns UUID |
| Backend | `POST /upload/:id/chunk/:n` — receives raw chunk (1MB), writes to disk |
| Backend | `POST /upload/:id/finalize` — assembles chunks in order, moves to destination |
| Frontend | `useChunkedUpload()` hook — slices file, sends chunks, tracks progress |
| Cleanup | Stale upload dirs auto-deleted after 1 hour (runs every 10min) |

**Memory usage:** 1MB per chunk — a 2GB world zip never loads into RAM.

**Retry logic:** Each chunk retries up to 3 times on failure.

**UI:** Upload button in Files page header. Progress bar + percentage during upload. File picker opens OS file dialog.

---

## Bugs Encountered & Resolved

| Bug | Symptom | Root Cause | Fix |
|-----|---------|-----------|-----|
| EBUSY on backup | "Drive backup failed: EBUSY resource busy" | Java locks `.mca` region files exclusively on Windows | Two-phase copy: readable files → temp dir → zip |
| Missing `isRunning` | Manual backup always used direct archiver | `drive.ts` called `backupWorldToDrive()` without `isRunning` | Added `getRunningServer()` check |
| Event loop freeze | Socket disconnects during modpack install | Synchronous `readdirSync` + `copyFileSync` on hundreds of files | Async 8-worker pool via `fs/promises` |
| Shell injection risk | Unnecessary `shell: true` on all spawns | Original workaround for hiding cmd window | `windowsHide: true` works without shell |
| Nested `level.dat` | "Restored world is missing level.dat" | `extract-zip` targeted `world/` but zip entries already prefixed with `world/` | Extract to parent dir so prefix maps correctly |
| Corepack key error | Friend couldn't run `pnpm dev` | Outdated Corepack on Node v20 | `npm install -g pnpm` bypasses Corepack |
| Duplicate toast import | TypeScript lint error | Double `import { toast }` in Files.tsx | Removed duplicate |
