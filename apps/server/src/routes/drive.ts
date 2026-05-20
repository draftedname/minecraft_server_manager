import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import {
  getDriveStatus,
  getAuthUrl,
  handleOAuthCallback,
  listDriveBackups,
  downloadDriveBackup,
  disconnectDrive,
  deleteDriveBackup,
  CREDENTIALS_PATH,
} from "../services/GoogleDriveService.js";
import {
  getScheduleConfig,
  saveScheduleConfig,
  startScheduler,
  stopScheduler,
  backupWorldToDrive,
} from "../services/BackupScheduler.js";
import { loadServer, getServerDir } from "../services/DataStore.js";
import { getRunningServer } from "../services/ServerManager.js";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

// Get Drive status
router.get("/drive/status", (_req: Request, res: Response) => {
  res.json(getDriveStatus());
});

// Get OAuth URL
router.get("/drive/auth-url", (_req: Request, res: Response) => {
  const url = getAuthUrl();
  if (!url) {
    res.status(400).json({ error: "Google credentials not configured. Place google-credentials.json in data/credentials/" });
    return;
  }
  res.json({ url });
});

// OAuth callback
router.get("/drive/oauth2callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }

  const success = await handleOAuthCallback(code);
  if (success) {
    res.send(`
      <html><body style="background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center">
          <h2>Google Drive connected!</h2>
          <p>You can close this window and return to MC Server GUI.</p>
        </div>
      </body></html>
    `);
  } else {
    res.status(500).send("Authentication failed");
  }
});

// Disconnect Drive
router.post("/drive/disconnect", async (_req: Request, res: Response) => {
  await disconnectDrive();
  stopScheduler();
  res.json({ success: true });
});

// Get schedule config
router.get("/drive/schedule", (_req: Request, res: Response) => {
  res.json(getScheduleConfig());
});

// Save schedule config
router.put("/drive/schedule", (req: Request, res: Response) => {
  const { enabled, intervalMinutes } = req.body;
  const config = { enabled: !!enabled, intervalMinutes: intervalMinutes || 360 };
  saveScheduleConfig(config);
  startScheduler();
  res.json({ success: true, config });
});

// List Drive backups
router.get("/drive/backups", async (req: Request, res: Response) => {
  const serverName = req.query.serverName;
  let backups = await listDriveBackups();
  if (serverName) {
    const name = String(serverName).toLowerCase();
    backups = backups.filter((b) => b.name.toLowerCase().startsWith(name));
  }
  res.json(backups);
});

// Delete Drive backup
router.delete("/drive/backups/:fileId", async (req: Request, res: Response) => {
  const fileId = p(req.params, "fileId");
  const ok = await deleteDriveBackup(fileId);
  if (ok) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Failed to delete from Drive" });
  }
});

// Download Drive backup
router.get("/drive/backups/:fileId/download", async (req: Request, res: Response) => {
  const tmpDir = path.join(process.cwd(), "..", "..", "data", "tmp");
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  const fileId = p(req.params, "fileId");
  const tmpPath = path.join(tmpDir, `drive-backup-${fileId}.zip`);
  const success = await downloadDriveBackup(fileId, tmpPath);
  if (success) {
    res.download(tmpPath, "backup.zip", () => {
      try { unlinkSync(tmpPath); } catch {}
    });
  } else {
    res.status(500).json({ error: "Download failed" });
  }
});

// Manual backup to Drive
router.post("/drive/backup", async (req: Request, res: Response) => {
  const { serverId, worldName } = req.body;
  if (!serverId) {
    res.status(400).json({ error: "serverId is required" });
    return;
  }

  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const world = worldName || "world";
  const serverDir = getServerDir(serverId);
  const worldPath = path.join(serverDir, world);

  if (!existsSync(worldPath)) {
    res.status(404).json({ error: `World '${world}' not found` });
    return;
  }

  const isRunning = !!getRunningServer(serverId);
  const result = await backupWorldToDrive(serverId, server.name, world, worldPath, isRunning);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Upload credentials file
router.post("/drive/credentials", async (req: Request, res: Response) => {
  const { credentials } = req.body;
  if (!credentials) {
    res.status(400).json({ error: "credentials JSON is required" });
    return;
  }

  try {
    JSON.parse(typeof credentials === "string" ? credentials : JSON.stringify(credentials));
    const dir = path.dirname(CREDENTIALS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      CREDENTIALS_PATH,
      typeof credentials === "string" ? credentials : JSON.stringify(credentials, null, 2),
      "utf-8"
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: `Invalid JSON: ${err.message}` });
  }
});

export { router as driveRouter };
