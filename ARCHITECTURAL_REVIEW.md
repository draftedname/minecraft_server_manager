# Architectural Review — MC Server GUI

## Part 1: Critical Architecture & Logic Issues

---

### 1. Automated Backup Skipping on Active Servers

**File:** `apps\server\src\services\BackupScheduler.ts:84`

**The Issue:**
```ts
if (existsSync(path.join(fullPath, "session.lock"))) continue;
```

Minecraft writes `session.lock` the instant a server starts and holds it until the process dies. This means the scheduler will never back up any running server. For production servers that stay online for days or weeks, the automated backup system is completely inert.

**Proposed Fix:**

Remove the `session.lock` guard entirely. The `archiver.directory()` call already handles locked files gracefully — it reads what it can and transparently skips files it can't access. A live-server backup won't be a perfectly consistent crash-consistent snapshot, but that is standard practice for hot backups.

If we want to minimize corruption risk, configure the archiver to explicitly exclude lock files while still backing up everything else:

```ts
archive.glob("**/*", {
  cwd: worldPath,
  ignore: ["session.lock", "*.lock"],
});
```

The UI should label live backups as "best effort" since the world is actively being written to — no different from how hosting panels handle it.

---

### 2. Event Loop Starvation During Modpack Processing

**Files:** `apps\server\src\routes\servers.ts:170-184` (inline `copyDir`), `apps\server\src\routes\modpacks.ts:135-147` (`copyDirSync`)

**The Issue:**

Both functions use fully synchronous `readdirSync` + `copyFileSync` inside the Express request handler. For a modpack with hundreds of config files and nested asset folders, this blocks Node's single execution thread for seconds. During that window:
- All socket.io WebSocket frames stall (heartbeat timeouts)
- Connected browser clients see disconnection
- All other API endpoints stop responding
- The entire backend freezes until the file copy finishes

**Proposed Fix:**

Replace both with an async version using `fs/promises` and a concurrency-limited pool:

```ts
import { readdir, mkdir, copyFile } from "fs/promises";

async function copyDirAsync(
  src: string,
  dest: string,
  concurrency = 8
): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  const queue = [...entries];

  const worker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await mkdir(d, { recursive: true });
        await copyDirAsync(s, d, concurrency);
      } else {
        await copyFile(s, d);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
```

Key points:
- Each `await` yields control back to the event loop
- The concurrency pool allows parallel file copies (configurable)
- Same approach replaces both the inline `copyDir` in `servers.ts` and the standalone `copyDirSync` in `modpacks.ts`
- Throttle the pool size to avoid overwhelming disk I/O (8 concurrent workers is a reasonable default)

---

### 3. Process Isolation Security Boundary

**File:** `apps\server\src\services\ServerManager.ts:124, 142, 166`

**The Issue:**

All three `spawn` calls use `shell: true`:

```ts
const proc = spawn(javaPath, args, {
  cwd: serverDir,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  shell: true,                    // <-- problematic
});
```

This passes the argument array through the system shell (`cmd.exe` on Windows, `/bin/sh` on Linux). If any argument contains un-sandboxed characters (backticks, `&&`, `;`, `$()`), the shell will interpret them before the Java binary runs. The primary vectors are `config.javaPath` (from user's server config) and the Fabric classpath string (from `fabric-profile.json`).

**Proposed Fix:**

Remove `shell: true` from all three spawn calls. `child_process.spawn` passes arguments directly to the executable with zero shell interpretation:

```ts
const proc = spawn(javaPath, args, {
  cwd: serverDir,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,              // works without shell
});
```

Benefits:
- No command injection surface
- Faster process creation (skips shell spawn overhead)
- `windowsHide: true` alone sets `CREATE_NO_WINDOW` on Windows — no shell needed for hiding the console window
- Each array element becomes an exact argv entry for Java

---

### 4. Redundant Log Payloads on Tab Navigation

**File:** `apps\client\src\hooks\consoleContext.tsx:52-69`

**The Issue (as described):**

The concern is that tab-switching triggers redundant `GET /console-history` API calls because `activeServers` tracking gets lost when components unmount.

**Current Behavior Analysis:**

Tracing the actual execution flow:

1. Console page mounts -> `subscribe(serverId)` called
2. `activeServers.has(serverId)` = false -> adds to set -> fires `GET /console-history`
3. History loaded into context state
4. User switches to Mods tab -> Console unmounts -> `unsubscribe(serverId)` called
5. `unsubscribe` leaves socket room but does NOT touch `activeServers`
6. User switches back to Console -> Console remounts -> `subscribe(serverId)` called
7. `activeServers.has(serverId)` = true -> **skips** history API call
8. `setLines` checks `current.length === 0` — buffer still has old lines -> **skips**

**Result:** The history API fires exactly once per server per page load. Tab switching does NOT trigger redundant fetches. The redundant-fetch issue described does not exist in the current implementation — `activeServers` and the `current.length === 0` guard together prevent it.

**Verdict:** No fix needed. The current design is correct.

The only time history reloads is on a full page refresh (F5), which resets all React state. This is intentional — after a full page reload the WebSocket buffer is empty, so backfilling from `latest.log` is required to fill the gap.

---

## Part 2: Future Feature Architecture

---

### 1. Transactional World Restoration

**Concept:** An async pipeline to restore a world from a local zip backup or Google Drive download, with full rollback safety.

**Pipeline (with rollback at each failure point):**

```
  ┌──────────────────────────────────────────────────────────┐
  │ 1. Verify server is stopped                              │
  │    - Check runningServers map for this serverId          │
  │    - If running: return error ("Stop the server first")  │
  └─────────────────────┬────────────────────────────────────┘
                        │ server stopped
  ┌─────────────────────▼────────────────────────────────────┐
  │ 2. Create backup of current world                        │
  │    - rename("world") → "world.backup.{timestamp}"        │
  │    - Timestamp prevents conflicts with concurrent ops    │
  └─────────────────────┬────────────────────────────────────┘
                        │ rename succeeds
  ┌─────────────────────▼────────────────────────────────────┐
  │ 3. Extract backup zip into fresh world directory         │
  │    - mkdir("world")                                      │
  │    - extract-zip or archiver.unpack into "world/"        │
  └─────────────────────┬────────────────────────────────────┘
                        │
               ┌────────▼────────┐
               │ extraction OK?  │
               └───┬─────────┬───┘
              YES  │         │  NO
                   │         │
  ┌────────────────▼┐  ┌─────▼────────────────────────────────┐
  │ 4a. Verify:     │  │ 4b. Rollback:                        │
  │     level.dat   │  │     rm("world")                      │
  │     exists in   │  │     rename("world.backup.{ts}")      │
  │     world/      │  │     → "world"                        │
  └──┬──────────────┘  │     return error("Restore failed")   │
     │                 └──────────────────────────────────────┘
  ┌──▼──────────────┐
  │ 5. Clean up      │
  │     rm("world.   │
  │     backup.{ts}")│
  │     return OK    │
  └─────────────────┘
```

**Implementation notes:**
- All operations use `fs.promises` (async)
- The extract step is already async via `extract-zip` or archiver
- If the zip is corrupted mid-stream, the catch block triggers the rollback path
- The old world backup is never deleted until the new one is verified

---

### 2. Chunked Streaming Uploads

**Concept:** Allow users to upload large files (world zips, mods, modpacks) through the Files browser without overflowing server RAM.

**Architecture:**

```
Client                         Server
  │                              │
  │  1. POST /upload/init        │
  │     { filename, size,       │
  │       totalChunks }          │
  │ ─────────────────────────►   │  Creates temp upload dir
  │   ◄─── { uploadId }          │  Returns UUID
  │                              │
  │  2. for each chunk:         │
  │     POST /upload/:uploadId   │
  │     /chunk/:index            │
  │     body: raw ArrayBuffer    │
  │     Header: Content-Range    │
  │ ─────────────────────────►   │  Appends to chunk file
  │   ◄─── { ok }               │  or temp assembly file
  │                              │
  │  3. POST /upload/:uploadId   │
  │     /finalize                │
  │     { destination }          │
  │ ─────────────────────────►   │  Moves assembled file
  │   ◄─── { path, size }       │  to final destination
```

**Client-side pseudocode:**
```ts
const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB
const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
const uploadId = crypto.randomUUID();

for (let i = 0; i < totalChunks; i++) {
  const start = i * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, file.size);
  const chunk = file.slice(start, end);

  // Retry up to 3 times per chunk
  for (let retry = 0; retry < 3; retry++) {
    try {
      await fetch(`/api/upload/${uploadId}/chunk/${i}`, {
        method: "POST",
        body: chunk,
        headers: {
          "Content-Range": `bytes ${start}-${end-1}/${file.size}`,
          "X-Upload-Id": uploadId,
        },
      });
      break;
    } catch {
      if (retry === 2) throw new Error(`Chunk ${i} failed`);
    }
  }
}

await fetch(`/api/upload/${uploadId}/finalize`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ destination: "mods/big-mod.jar" }),
});
```

**Server-side:**
- Stream writes each chunk to `data/uploads/{uploadId}/` using `fs.promises.appendFile` or `createWriteStream` with `{ flags: "a" }`
- Memory usage: one chunk buffer at a time (1MB max)
- On finalize: atomically move the assembled file to the target path via `fs.promises.rename`
- Upload state cleanup: periodic job to delete stale upload directories older than 1 hour
- No additional npm packages needed — all built-in Node APIs (File, fetch, fs)

**Total code:** roughly 120 lines of backend + 60 lines of frontend.
