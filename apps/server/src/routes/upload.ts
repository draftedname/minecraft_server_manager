import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync, createWriteStream, rmSync, readFileSync, readdirSync, statSync } from "fs";
import { v4 as uuid } from "uuid";
import { DATA_DIR } from "../services/config.js";

const router = Router();

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

function p(params: any, key: string): string {
  return String(params[key]);
}

// Track active upload sessions
const uploadSessions = new Map<string, {
  filename: string;
  totalChunks: number;
  receivedChunks: Set<number>;
  destDir: string;
}>();

// Initialize a new chunked upload
router.post("/upload/init", (req: Request, res: Response) => {
  const { filename, totalChunks, destination } = req.body;

  if (!filename || !totalChunks) {
    res.status(400).json({ error: "filename and totalChunks are required" });
    return;
  }

  const uploadId = uuid();
  const uploadDir = path.join(UPLOADS_DIR, uploadId);

  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  uploadSessions.set(uploadId, {
    filename,
    totalChunks,
    receivedChunks: new Set(),
    destDir: destination || "",
  });

  res.json({ uploadId });
});

// Upload a single chunk
router.post("/upload/:uploadId/chunk/:index", (req: Request, res: Response) => {
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

  // Collect raw body chunks
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    try {
      const chunkData = Buffer.concat(chunks);
      const chunkPath = path.join(UPLOADS_DIR, uploadId, `chunk-${index}`);

      // Write chunk to disk
      const ws = createWriteStream(chunkPath);
      ws.write(chunkData);
      ws.end(() => {
        session.receivedChunks.add(index);
        res.json({ ok: true, index, received: session.receivedChunks.size });
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  req.on("error", (err) => {
    res.status(500).json({ error: err.message });
  });
});

// Finalize: assemble chunks into final file
router.post("/upload/:uploadId/finalize", (req: Request, res: Response) => {
  const uploadId = p(req.params, "uploadId");
  const session = uploadSessions.get(uploadId);

  if (!session) {
    res.status(404).json({ error: "Upload session not found" });
    return;
  }

  if (session.receivedChunks.size !== session.totalChunks) {
    res.status(400).json({
      error: `Missing chunks: received ${session.receivedChunks.size}/${session.totalChunks}`,
    });
    return;
  }

  try {
    const uploadDir = path.join(UPLOADS_DIR, uploadId);

    // Determine destination
    const destFile = session.destDir
      ? path.join(session.destDir, session.filename)
      : path.join(uploadDir, session.filename);

    const destDir = path.dirname(destFile);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    // Open destination write stream (truncate)
    const dest = createWriteStream(destFile, { flags: "w" });
    let assembledSize = 0;

    // Assemble chunks in order
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `chunk-${i}`);
      if (!existsSync(chunkPath)) {
        res.status(500).json({ error: `Chunk ${i} missing on disk` });
        return;
      }

      const data = readFileSync(chunkPath);
      dest.write(data);
      assembledSize += data.length;
    }

    dest.end(() => {
      // Clean up upload session
      try { rmSync(uploadDir, { recursive: true, force: true }); } catch {}
      uploadSessions.delete(uploadId);

      res.json({
        success: true,
        path: destFile,
        size: assembledSize,
      });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
}, 600000); // every 10 minutes

export { router as uploadRouter };
