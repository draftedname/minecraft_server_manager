// MC Server GUI
import { Router, Request, Response } from "express";
import path from "path";
import archiver from "archiver";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "fs";
import { createWriteStream } from "fs";
import { v4 as uuid } from "uuid";
import { loadServer, getServerDir } from "../services/DataStore.js";
import { BACKUPS_DIR } from "../services/config.js";
import { restoreWorld, restoreWorldFromDrive } from "../services/WorldRestoreService.js";
import { getRunningServer } from "../services/ServerManager.js";
import { copyReadable } from "../services/FileUtils.js";
import type { WorldInfo, BackupMeta } from "@mcservergui/shared";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

router.get("/:serverId/worlds", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const serverDir = getServerDir(serverId);

  const worlds: WorldInfo[] = [];
  const entries = existsSync(serverDir) ? readdirSync(serverDir) : [];

  for (const entry of entries) {
    const fullPath = path.join(serverDir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (existsSync(path.join(fullPath, "level.dat"))) {
        worlds.push({
          name: entry,
          size: getDirSize(fullPath),
          lastModified: stat.mtime.toISOString(),
        });
      }
    }
  }

  res.json(worlds);
});

router.get("/:serverId/backups", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const backupsDir = path.join(BACKUPS_DIR, serverId);

  if (!existsSync(backupsDir)) {
    res.json([]);
    return;
  }

  const files = readdirSync(backupsDir).filter((f) => f.endsWith(".zip"));
  const backups: BackupMeta[] = files.map((f) => {
    const filePath = path.join(backupsDir, f);
    const stat = statSync(filePath);
    return {
      id: f.replace(".zip", ""),
      worldName: "world",
      serverId,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
      drive: false,
    };
  });

  res.json(backups);
});

router.post("/:serverId/worlds/backup", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { worldName } = req.body;
  const worldToBackup = worldName || "world";
  const worldPath = path.join(getServerDir(serverId), worldToBackup);

  if (!existsSync(worldPath)) {
    res.status(404).json({ error: `World '${worldToBackup}' not found` });
    return;
  }

  const backupId = uuid();
  const backupsDir = path.join(BACKUPS_DIR, serverId);
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });

  const zipPath = path.join(backupsDir, `${backupId}.zip`);

  // If server is running, copy readable files to temp first to avoid EBUSY crashes
  const isRunning = !!getRunningServer(serverId);
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(output);

  if (isRunning) {
    const tempDir = path.join(backupsDir, `.tmp-local-${serverId}-${backupId}`);
    try {
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      mkdirSync(tempDir, { recursive: true });
      await copyReadable(worldPath, tempDir);
      archive.directory(tempDir, worldToBackup);
    } finally {
      if (existsSync(tempDir)) {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    }
  } else {
    archive.directory(worldPath, worldToBackup);
  }

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
    archive.finalize();
  });

  res.json({ id: backupId, path: zipPath });
});

// Restore world from a local backup
router.post("/:serverId/worlds/restore", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { worldName, backupId } = req.body;

  if (!backupId) {
    res.status(400).json({ error: "backupId is required" });
    return;
  }

  const zipPath = path.join(BACKUPS_DIR, serverId, `${backupId}.zip`);
  if (!existsSync(zipPath)) {
    res.status(404).json({ error: "Backup file not found" });
    return;
  }

  const result = await restoreWorld(serverId, worldName || "world", zipPath);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, rollbackPerformed: result.rollbackPerformed });
});

// Restore world from a Google Drive backup
router.post("/:serverId/worlds/restore-drive", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { worldName, driveFileId } = req.body;

  if (!driveFileId) {
    res.status(400).json({ error: "driveFileId is required" });
    return;
  }

  const result = await restoreWorldFromDrive(serverId, worldName || "world", driveFileId);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, rollbackPerformed: result.rollbackPerformed });
});

router.delete("/:serverId/backups/:backupId", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const backupId = p(req.params, "backupId");
  const zipPath = path.join(BACKUPS_DIR, serverId, `${backupId}.zip`);

  if (!existsSync(zipPath)) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  unlinkSync(zipPath);
  res.json({ success: true });
});

router.get("/:serverId/backups/:backupId/download", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const backupId = p(req.params, "backupId");
  const zipPath = path.join(BACKUPS_DIR, serverId, `${backupId}.zip`);

  if (!existsSync(zipPath)) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  res.download(zipPath);
});

function getDirSize(dir: string): number {
  let size = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      try {
        size += statSync(fullPath).size;
      } catch {
        // Skip
      }
    }
  }
  return size;
}

// Import a zip file as a world
router.post("/:serverId/worlds/import", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { zipPath } = req.body;

  if (!zipPath) {
    res.status(400).json({ error: "zipPath is required" });
    return;
  }

  const serverDir = getServerDir(serverId);
  const isRunning = !!getRunningServer(serverId);
  if (isRunning) {
    res.status(400).json({ error: "Server is running. Stop it before importing a world." });
    return;
  }

  // Detect world name from zip filename
  const zipName = path.basename(zipPath, ".zip").replace(/[^a-zA-Z0-9_-]/g, "_") || "imported_world";
  const worldDir = path.join(serverDir, zipName);

  // Extract zip into worlds directory
  try {
    const { default: extract } = await import("extract-zip");

    // Extract to temp first, then check for level.dat, then move to final location
    const tempDir = path.join(serverDir, `.import-tmp`);
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    await extract(zipPath, { dir: tempDir });

    // Check if zip has a root world folder or flat structure
    let worldRoot = tempDir;
    const entries = readdirSync(tempDir, { withFileTypes: true });
    if (entries.length === 1 && entries[0].isDirectory()) {
      worldRoot = path.join(tempDir, entries[0].name);
    }

    if (!existsSync(path.join(worldRoot, "level.dat"))) {
      rmSync(tempDir, { recursive: true, force: true });
      res.status(400).json({ error: "This zip does not contain a Minecraft world (no level.dat found)" });
      return;
    }

    // Remove existing world dir if it exists
    if (existsSync(worldDir)) rmSync(worldDir, { recursive: true, force: true });

    // Move world to final location
    const { renameSync } = await import("fs");
    renameSync(worldRoot, worldDir);
    rmSync(tempDir, { recursive: true, force: true });

    // Update server.properties level-name
    const propsPath = path.join(serverDir, "server.properties");
    if (existsSync(propsPath)) {
      const propsContent = (await import("fs")).readFileSync(propsPath, "utf-8");
      const lines = propsContent.split("\n");
      const newLines: string[] = [];
      let found = false;
      for (const line of lines) {
        if (line.startsWith("level-name=")) {
          newLines.push(`level-name=${zipName}`);
          found = true;
        } else {
          newLines.push(line);
        }
      }
      if (!found) newLines.push(`level-name=${zipName}`);
      (await import("fs")).writeFileSync(propsPath, newLines.join("\n"), "utf-8");
    }

    res.json({ success: true, worldName: zipName, path: worldDir });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as worldsRouter };

