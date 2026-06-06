import { Router, Request, Response } from "express";
import path from "path";
import {
  readdirSync,
  statSync,
  existsSync,
  unlinkSync,
  rmdirSync,
  createReadStream,
} from "fs";
import { loadServer, getServerDir } from "../services/DataStore.js";
import { safeJoin, PathTraversalError } from "../services/safeJoin.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = Router();

import { p } from "../lib/params.js";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

// List all files in server directory
router.get("/:serverId/files", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const serverDir = getServerDir(serverId);
  const { relpath } = req.query;

  let targetDir: string;
  try {
    targetDir = relpath
      ? safeJoin(serverDir, String(relpath))
      : serverDir;
  } catch (err) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    throw err;
  }

  if (!existsSync(targetDir)) {
    res.json([]);
    return;
  }

  try {
    const items = readdirSync(targetDir, { withFileTypes: true });
    const files: FileEntry[] = [];

    for (const item of items) {
      const fullPath = path.join(targetDir, item.name);
      const relPath = relpath ? path.join(String(relpath), item.name) : item.name;
      const stat = statSync(fullPath);

      if (item.isDirectory()) {
        files.push({
          name: item.name,
          path: relPath,
          type: "directory",
          size: 0,
          modified: stat.mtime.toISOString(),
        });
      } else {
        files.push({
          name: item.name,
          path: relPath,
          type: "file",
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file or directory
router.delete("/:serverId/files", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { relpath } = req.body;
  if (!relpath) {
    res.status(400).json({ error: "relpath is required" });
    return;
  }

  const serverDir = getServerDir(serverId);
  let fullPath: string;
  try {
    fullPath = safeJoin(serverDir, relpath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    throw err;
  }

  if (!existsSync(fullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      rmdirSync(fullPath, { recursive: true });
    } else {
      unlinkSync(fullPath);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Download file
router.get("/:serverId/files/download", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const relpath = req.query.relpath;
  if (!relpath) {
    res.status(400).json({ error: "relpath query param is required" });
    return;
  }

  const serverDir = getServerDir(serverId);
  let fullPath: string;
  try {
    fullPath = safeJoin(serverDir, String(relpath));
  } catch (err) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    throw err;
  }

  if (!existsSync(fullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const filename = path.basename(fullPath);
  res.download(fullPath, filename);
});

// Open file in system editor
router.post("/:serverId/files/open", asyncHandler(async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const { relpath } = req.body;

  if (!relpath) {
    res.status(400).json({ error: "relpath is required" });
    return;
  }

  const server = loadServer(serverId);
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }

  const serverDir = getServerDir(serverId);
  let fullPath: string;
  try {
    fullPath = safeJoin(serverDir, relpath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    throw err;
  }

  if (!existsSync(fullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const { spawn } = await import("child_process");
  const cmd = process.platform === "win32" ? "notepad.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? [fullPath] : process.platform === "darwin" ? ["-a", "TextEdit", fullPath] : [fullPath];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();

  res.json({ success: true });
}));

// Upload file
router.post("/:serverId/files/upload", (req: Request, res: Response) => {
  res.status(501).json({ error: "Upload not yet implemented" });
});

export { router as filesRouter };
