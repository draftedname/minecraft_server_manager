import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync, createWriteStream, createReadStream, rmSync, readdirSync, statSync, unlinkSync } from "fs";
import { finished } from "stream/promises";
import { v4 as uuid } from "uuid";
import { DATA_DIR } from "../services/config.js";
import { safeJoin } from "../services/safeJoin.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import type { UploadInitRequest } from "@mcservergui/shared";

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

import { p } from "../lib/params.js";

interface UploadSession {
  filename: string;
  totalChunks: number;
  receivedChunks: Set<number>;
}

// Track active upload sessions
const uploadSessions = new Map<string, UploadSession>();

// --- raw chunk router (mounted before express.json to avoid buffering) ---

const chunkRouter = Router();

const MAX_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per chunk

chunkRouter.post("/upload/:uploadId/chunk/:index", (req: Request, res: Response) => {
  const uploadId = p(req.params, "uploadId");
  const index = parseInt(p(req.params, "index"), 10);

  const session = uploadSessions.get(uploadId);
  if (!session) {
    res.status(404).json({ error: "Upload session not found" });
    return;
  }

  if (isNaN(index) || index < 0 || index >= session.totalChunks) {
    res.status(400).json({ error: "Invalid chunk index" });
    return;
  }

  let size = 0;
  let exceeded = false;
  const chunkPath = path.join(UPLOADS_DIR, uploadId, `chunk-${index}`);
  const ws = createWriteStream(chunkPath);

  req.on("data", (chunk: Buffer) => {
    if (exceeded) return;
    size += chunk.length;
    if (size > MAX_CHUNK_SIZE) {
      exceeded = true;
      ws.destroy();
      res.status(413).json({ error: "Chunk too large" });
      res.on("finish", () => req.destroy());
      return;
    }
    ws.write(chunk);
  });

  req.on("end", () => {
    ws.end(() => {
      session.receivedChunks.add(index);
      res.json({ ok: true, index, received: session.receivedChunks.size });
    });
  });

  ws.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });

  req.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });
});

// --- main upload router (init, finalize, cleanup) ---

const router = Router();

const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB total

// Initialize a new chunked upload
router.post("/upload/init", asyncHandler((req: Request, res: Response) => {
  const { filename, totalChunks } = req.body as UploadInitRequest;

  if (!filename || !totalChunks) {
    res.status(400).json({ error: "filename and totalChunks are required" });
    return;
  }

  if (totalChunks > 4096) {
    res.status(400).json({ error: "Too many chunks (max 4096)" });
    return;
  }

  const uploadId = uuid();
  const uploadDir = path.join(UPLOADS_DIR, uploadId);

  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  uploadSessions.set(uploadId, {
    filename: filename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 255),
    totalChunks,
    receivedChunks: new Set(),
  });

  res.json({ uploadId });
}));

// Finalize: assemble chunks into final file
router.post("/upload/:uploadId/finalize", asyncHandler(async (req: Request, res: Response) => {
  const uploadId = p(req.params, "uploadId");
  const session = uploadSessions.get(uploadId);
  const uploadDir = path.join(UPLOADS_DIR, uploadId);

  if (!session) {
    res.status(404).json({ error: "Upload session not found" });
    return;
  }

  if (session.receivedChunks.size !== session.totalChunks) {
    uploadSessions.delete(uploadId);
    try { rmSync(uploadDir, { recursive: true, force: true }); } catch {}
    res.status(400).json({
      error: `Missing chunks: received ${session.receivedChunks.size}/${session.totalChunks}`,
    });
    return;
  }

  let destFile = "";
  let dest: ReturnType<typeof createWriteStream> | null = null;

  try {
    destFile = safeJoin(UPLOADS_DIR, `${uploadId}-${session.filename}`);
    const destDir = path.dirname(destFile);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    let assembledSize = 0;
    dest = createWriteStream(destFile, { flags: "w" });

    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `chunk-${i}`);
      if (!existsSync(chunkPath)) {
        throw new Error(`Chunk ${i} missing on disk`);
      }

      const { size: chunkSize } = statSync(chunkPath);
      assembledSize += chunkSize;
      if (assembledSize > MAX_FILE_SIZE) {
        throw new Error("File exceeds maximum size");
      }

      const source = createReadStream(chunkPath);
      source.pipe(dest, { end: false });
      await finished(source);
    }

    await new Promise<void>((resolve, reject) => {
      dest!.end(() => resolve());
      dest!.on("error", reject);
    });
  } catch (err: any) {
    if (dest) {
      try { dest.destroy(); } catch {}
    }
    if (destFile && existsSync(destFile)) {
      try { unlinkSync(destFile); } catch {}
    }
    res.status(500).json({ error: err.message });
    return;
  } finally {
    uploadSessions.delete(uploadId);
    try { rmSync(uploadDir, { recursive: true, force: true }); } catch {}
  }

  res.json({
    success: true,
    path: destFile,
    size: statSync(destFile).size,
  });
}));

// Cleanup stale uploads older than 1 hour
setInterval(() => {
  if (!existsSync(UPLOADS_DIR)) return;
  const entries = readdirSync(UPLOADS_DIR);
  const cutoff = Date.now() - 3600000;
  for (const entry of entries) {
    const p = path.join(UPLOADS_DIR, entry);
    try {
      const st = statSync(p);
      if (st.mtimeMs < cutoff) {
        rmSync(p, { recursive: true, force: true });
        uploadSessions.delete(entry);
      }
    } catch {}
  }
}, 600000);

export { router as uploadRouter, chunkRouter as uploadChunkRouter };
