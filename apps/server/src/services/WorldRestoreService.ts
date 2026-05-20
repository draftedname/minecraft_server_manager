// MC Server GUI
import path from "path";
import { existsSync, rmSync } from "fs";
import { rename, mkdir } from "fs/promises";
import { getServerDir } from "./DataStore.js";
import { getRunningServer } from "./ServerManager.js";
import { downloadDriveBackup } from "./GoogleDriveService.js";
import { BACKUPS_DIR } from "./config.js";

interface RestoreResult {
  success: boolean;
  error?: string;
  rollbackPerformed?: boolean;
}

/**
 * Transactional world restoration with automatic rollback.
 *
 * Pipeline:
 *  1. Verify server is stopped
 *  2. Rename current world -> world.backup.{timestamp}
 *  3. Extract backup zip into fresh world directory
 *  4. Verify level.dat exists in restored world
 *  5. On success: delete the backup
 *  6. On failure: delete partial world, rename backup back -> world
 */
export async function restoreWorld(
  serverId: string,
  worldName: string,
  zipPath: string
): Promise<RestoreResult> {
  const serverDir = getServerDir(serverId);
  const worldPath = path.join(serverDir, worldName);
  const timestamp = Date.now();
  const backupPath = path.join(serverDir, `${worldName}.backup.${timestamp}`);

  // Step 1 — verify server is stopped
  if (getRunningServer(serverId)) {
    return { success: false, error: "Server is running. Stop it before restoring a world." };
  }

  // If world doesn't exist, create it fresh (no backup needed)
  const hadWorld = existsSync(worldPath);

  // Step 2 — backup current world if it exists
  if (hadWorld) {
    try {
      await rename(worldPath, backupPath);
    } catch (err: any) {
      return { success: false, error: `Failed to back up current world: ${err.message}` };
    }
  }

  // Step 3 — create fresh world directory and extract
  // The zip was created with archive.directory(worldPath, worldName), so entries
  // are prefixed with worldName/. Extract to the parent directory (serverDir)
  // so the prefix maps correctly to the actual world directory on disk.
  try {
    await mkdir(worldPath, { recursive: true });
    const { default: extract } = await import("extract-zip");
    await extract(zipPath, { dir: serverDir });
  } catch (err: any) {
    // Step 6 — rollback
    await rollback(worldPath, backupPath, hadWorld);
    return {
      success: false,
      error: `Extraction failed: ${err.message}`,
      rollbackPerformed: true,
    };
  }

  // Step 4 — verify extraction
  if (!existsSync(path.join(worldPath, "level.dat"))) {
    await rollback(worldPath, backupPath, hadWorld);
    return {
      success: false,
      error: "Restored world is missing level.dat. The backup may be corrupted.",
      rollbackPerformed: true,
    };
  }

  // Step 5 — success, clean up the backup
  if (hadWorld && existsSync(backupPath)) {
    try { rmSync(backupPath, { recursive: true, force: true }); } catch {}
  }

  return { success: true };
}

/**
 * Restore a world from a Google Drive backup file.
 */
export async function restoreWorldFromDrive(
  serverId: string,
  worldName: string,
  driveFileId: string
): Promise<RestoreResult> {
  const serverDir = getServerDir(serverId);
  const tmpDir = path.join(serverDir, ".restore-tmp");
  const tmpZip = path.join(tmpDir, "backup.zip");

  // Ensure temp directory
  if (!existsSync(tmpDir)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(tmpDir, { recursive: true });
  }

  // Download from Drive
  const downloaded = await downloadDriveBackup(driveFileId, tmpZip);
  if (!downloaded) {
    return { success: false, error: "Failed to download backup from Google Drive" };
  }

  // Run the standard restore pipeline
  const result = await restoreWorld(serverId, worldName, tmpZip);

  // Clean up temp files
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return result;
}

async function rollback(
  worldPath: string,
  backupPath: string,
  hadWorld: boolean
): Promise<void> {
  // Delete the failed partial extraction
  if (existsSync(worldPath)) {
    try { rmSync(worldPath, { recursive: true, force: true }); } catch {}
  }

  // Restore the backup if there was one
  if (hadWorld && existsSync(backupPath)) {
    try { await rename(backupPath, worldPath); } catch {}
  }
}

