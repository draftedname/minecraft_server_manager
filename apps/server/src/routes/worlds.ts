import { Router, Request, Response } from "express";
import path from "path";
import archiver from "archiver";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createWriteStream } from "fs";
import { readdir, stat } from "fs/promises";
import { v4 as uuid } from "uuid";
import { loadServer, getServerDir } from "../services/DataStore.js";
import { BACKUPS_DIR, DATA_DIR } from "../services/config.js";
import { restoreWorld, restoreWorldFromDrive } from "../services/WorldRestoreService.js";
import { getRunningServer } from "../services/ServerManager.js";
import { copyReadable } from "../services/FileUtils.js";
import type { WorldInfo, BackupMeta, WorldImportRequest } from "@mcservergui/shared";
import { safeJoin, PathTraversalError } from "../services/safeJoin.js";
const router = Router();

import { p } from "../lib/params.js";

router.get("/:serverId/worlds", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const serverDir = getServerDir(serverId);

  // Read the active world name from server.properties
  let currentLevelName = "world";
  const propsPath = path.join(serverDir, "server.properties");
  if (existsSync(propsPath)) {
    try {
      const content = readFileSync(propsPath, "utf-8");
      const match = content.match(/^level-name=(.+)$/m);
      if (match) currentLevelName = match[1].trim();
    } catch {}
  }

  const entries = existsSync(serverDir) ? readdirSync(serverDir) : [];

  const results = await Promise.all(
    entries
      .filter((entry) => {
        const fullPath = path.join(serverDir, entry);
        const stat = statSync(fullPath);
        return stat.isDirectory() && existsSync(path.join(fullPath, "level.dat"));
      })
      .map(async (entry) => ({
        name: entry,
        size: await getDirSizeAsync(path.join(serverDir, entry)),
        lastModified: statSync(path.join(serverDir, entry)).mtime.toISOString(),
        isActive: entry === currentLevelName,
      }))
  );

  res.json(results);
});

// Create local backup of a world
router.post("/:serverId/worlds/backup", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { worldName } = req.body;
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const world = worldName || "world";
  const serverDir = getServerDir(serverId);
  let worldPath: string;
  try {
    worldPath = safeJoin(serverDir, world);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    throw err;
  }

  if (!existsSync(worldPath)) {
    res.status(404).json({ error: `World '${world}' not found` });
    return;
  }

  const backupId = uuid();
  const safeWorld = world.replace(/[^a-zA-Z0-9_-]/g, "_");
  const zipFilename = `${safeWorld}--${backupId}.zip`;
  const backupsDir = path.join(BACKUPS_DIR, serverId);
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });
  const zipPath = path.join(backupsDir, zipFilename);

  const isRunning = !!getRunningServer(serverId);
  let tempDir: string | null = null;

  try {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    if (isRunning) {
      const timestamp = Date.now();
      tempDir = path.join(BACKUPS_DIR, `.tmp-${serverId}-${timestamp}`);
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      mkdirSync(tempDir, { recursive: true });
      await copyReadable(worldPath, tempDir);
      archive.directory(tempDir, world);
    } else {
      archive.directory(worldPath, world);
    }

    const streamDone = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.finalize();
    });
    await streamDone;
  } catch (err: any) {
    try { unlinkSync(zipPath); } catch {}
    res.status(500).json({ error: err.message });
    return;
  } finally {
    if (tempDir && existsSync(tempDir)) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  const size = existsSync(zipPath) ? statSync(zipPath).size : 0;
  res.json({ backupId, size, worldName: world, createdAt: new Date().toISOString() });
});

// Restore world from a local backup
router.post("/:serverId/worlds/restore", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { worldName, backupId } = req.body;

  if (!backupId) {
    res.status(400).json({ error: "backupId is required" });
    return;
  }

  const zipPath = findBackupZip(serverId, backupId);
  if (!zipPath || !existsSync(zipPath)) {
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

// Restore world from Google Drive backup
router.post("/:serverId/worlds/restore-drive", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { driveFileId, worldName } = req.body;

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

// Import a zip file as a world
router.post("/:serverId/worlds/import", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { zipPath } = req.body as WorldImportRequest;

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

  // Validate zipPath is within a trusted directory
  const uploadsDir = path.resolve(path.join(DATA_DIR, "uploads"));
  const resolvedZip = path.resolve(zipPath);
  if (!resolvedZip.startsWith(path.resolve(BACKUPS_DIR)) && !resolvedZip.startsWith(uploadsDir)) {
    res.status(403).json({ error: "Access denied" });
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

    // Guardrail: verify recognizable Minecraft world structure
    const hasRegion = existsSync(path.join(worldRoot, "region"));
    const hasDims = existsSync(path.join(worldRoot, "DIM-1")) || existsSync(path.join(worldRoot, "DIM1"));
    const warnings: string[] = [];
    if (!hasRegion && !hasDims) {
      warnings.push("This world appears incomplete — no region or dimension folders found. It may not load correctly.");
    }
    warnings.push("Imported worlds may not be compatible if they were created with a different Minecraft version or mod set.");

    // Remove existing world dir if it exists
    if (existsSync(worldDir)) rmSync(worldDir, { recursive: true, force: true });

    // Move world to final location
    renameSync(worldRoot, worldDir);
    rmSync(tempDir, { recursive: true, force: true });

    // Update server.properties level-name
    const propsPath = path.join(serverDir, "server.properties");
    if (existsSync(propsPath)) {
      const propsContent = readFileSync(propsPath, "utf-8");
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
      writeFileSync(propsPath, newLines.join("\n"), "utf-8");
    }

    res.json({ success: true, worldName: zipName, path: worldDir, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const sizeCache = new Map<string, { size: number; timestamp: number }>();
const SIZE_CACHE_TTL = 30000;
const sizeComputing = new Set<string>();

async function getDirSizeAsync(dir: string): Promise<number> {
  const cached = sizeCache.get(dir);
  if (cached && Date.now() - cached.timestamp < SIZE_CACHE_TTL) return cached.size;

  // Return stale value or 0 immediately, recompute in background
  const stale = cached?.size ?? 0;

  if (!sizeComputing.has(dir)) {
    sizeComputing.add(dir);
    computeDirSize(dir).finally(() => sizeComputing.delete(dir));
  }

  return stale;
}

async function computeDirSize(dir: string): Promise<void> {
  let size = 0;
  const names = await readdir(dir, { withFileTypes: true });
  for (const entry of names) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += await getDirSizeAsync(fullPath);
    } else {
      try {
        const st = await stat(fullPath);
        size += st.size;
      } catch {}
    }
  }
  sizeCache.set(dir, { size, timestamp: Date.now() });
}

function findBackupZip(serverId: string, backupId: string): string | null {
  const backupsDir = path.join(BACKUPS_DIR, serverId);
  if (!existsSync(backupsDir)) return null;
  const files = readdirSync(backupsDir);
  // New format: worldName--uuid.zip
  const match = files.find((f) => f.endsWith(`--${backupId}.zip`) || f === `${backupId}.zip`);
  return match ? path.join(backupsDir, match) : null;
}

function parseBackupFilename(filename: string): { worldName: string; backupId: string } {
  const name = filename.replace(/\.zip$/, "");
  const sepIdx = name.indexOf("--");
  if (sepIdx > 0) {
    return { worldName: name.substring(0, sepIdx), backupId: name.substring(sepIdx + 2) };
  }
  // Legacy: bare UUID filename (no world name encoded)
  return { worldName: "world", backupId: name };
}

// List backups for a server
router.get("/:serverId/backups", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const backupsDir = path.join(BACKUPS_DIR, serverId);
  if (!existsSync(backupsDir)) {
    res.json([]);
    return;
  }

  const files = readdirSync(backupsDir).filter((f) => f.endsWith(".zip"));
  const backups: BackupMeta[] = files.map((f) => {
    const p = path.join(backupsDir, f);
    const st = statSync(p);
    const { worldName, backupId } = parseBackupFilename(f);
    return {
      id: backupId,
      worldName,
      serverId,
      size: st.size,
      createdAt: st.mtime.toISOString(),
      drive: false,
    };
  });

  res.json(backups);
});

// Download a local backup
router.get("/:serverId/backups/:backupId/download", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const backupId = p(req.params, "backupId");

  const zipPath = findBackupZip(serverId, backupId);
  if (!zipPath || !existsSync(zipPath)) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  res.download(zipPath, `backup-${backupId}.zip`);
});

// Delete a backup
router.delete("/:serverId/backups/:backupId", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const backupId = p(req.params, "backupId");

  const zipPath = findBackupZip(serverId, backupId);
  if (!zipPath || !existsSync(zipPath)) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  unlinkSync(zipPath);
  res.json({ success: true });
});

// Activate a dormant world
router.put("/:serverId/worlds/:worldName/activate", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const worldName = p(req.params, "worldName");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  if (getRunningServer(serverId)) {
    res.status(400).json({ error: "Server is running. Stop it before changing worlds." });
    return;
  }

  const serverDir = getServerDir(serverId);
  let targetPath: string;
  try {
    targetPath = safeJoin(serverDir, worldName);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    throw err;
  }

  if (!existsSync(targetPath) || !existsSync(path.join(targetPath, "level.dat"))) {
    res.status(404).json({ error: `World '${worldName}' not found or has no level.dat` });
    return;
  }

  const propsPath = path.join(serverDir, "server.properties");
  if (!existsSync(propsPath)) {
    res.status(500).json({ error: "server.properties not found" });
    return;
  }

  const content = readFileSync(propsPath, "utf-8");
  const lines = content.split("\n");
  const newLines: string[] = [];
  let found = false;
  for (const line of lines) {
    if (line.startsWith("level-name=")) {
      newLines.push(`level-name=${worldName}`);
      found = true;
    } else {
      newLines.push(line);
    }
  }
  if (!found) newLines.push(`level-name=${worldName}`);
  writeFileSync(propsPath, newLines.join("\n"), "utf-8");

  res.json({ success: true, worldName, active: true });
});

// Delete a world
router.delete("/:serverId/worlds/:worldName", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const worldName = p(req.params, "worldName");
  const server = loadServer(serverId);
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  if (getRunningServer(serverId)) { res.status(400).json({ error: "Stop the server before deleting a world" }); return; }

  const serverDir = getServerDir(serverId);
  const worldPath = path.join(serverDir, worldName);
  if (!existsSync(worldPath) || !existsSync(path.join(worldPath, "level.dat"))) {
    res.status(404).json({ error: "World not found" });
    return;
  }

  // Check if deleting the active world, update server.properties
  const propsPath = path.join(serverDir, "server.properties");
  if (existsSync(propsPath)) {
    const lines = readFileSync(propsPath, "utf-8").split("\n");
    const newLines = lines.map((l) => {
      if (l.startsWith("level-name=")) return `level-name=world`;
      return l;
    });
    writeFileSync(propsPath, newLines.join("\n"), "utf-8");
  }

  rmSync(worldPath, { recursive: true, force: true });
  res.json({ success: true });
});

export { router as worldsRouter };
