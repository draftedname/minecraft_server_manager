import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync, rmSync } from "fs";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import cron from "node-cron";
import archiver from "archiver";
import { loadServers, getServerDir } from "./DataStore.js";
import { uploadBackupToDrive } from "./GoogleDriveService.js";
import { getDriveStatus } from "./GoogleDriveService.js";
import { BACKUPS_DIR } from "./config.js";
import { copyReadable } from "./FileUtils.js";

interface ScheduleConfig {
  enabled: boolean;
  intervalMinutes: number;
}

const SCHEDULE_PATH = path.join(BACKUPS_DIR, "..", "backup-schedule.json");

function getConfigPath(): string {
  const dir = path.dirname(SCHEDULE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return SCHEDULE_PATH;
}

export function getScheduleConfig(): ScheduleConfig {
  const p = getConfigPath();
  if (!existsSync(p)) return { enabled: false, intervalMinutes: 360 };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { enabled: false, intervalMinutes: 360 };
  }
}

export function saveScheduleConfig(config: ScheduleConfig): void {
  const p = getConfigPath();
  writeFileSync(p, JSON.stringify(config, null, 2), "utf-8");
}

let cronJob: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  stopScheduler();

  const config = getScheduleConfig();
  if (!config.enabled) return;

  const driveStatus = getDriveStatus();
  if (!driveStatus.authenticated) return;

  const minutes = Math.max(30, config.intervalMinutes);
  const cronExpr = `*/${minutes} * * * *`;

  cronJob = cron.schedule(cronExpr, async () => {
    await runScheduledBackup();
  });

  console.log(`Backup scheduler started: every ${minutes} min`);
}

export function stopScheduler(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

async function runScheduledBackup(): Promise<void> {
  const driveStatus = getDriveStatus();
  if (!driveStatus.authenticated) return;

  const servers = loadServers();

  for (const server of servers) {
    const serverDir = getServerDir(server.id);
    if (!existsSync(serverDir)) continue;

    // Find worlds
    const entries = existsSync(serverDir) ? readdirSync(serverDir) : [];
    for (const entry of entries) {
      const fullPath = path.join(serverDir, entry);
      if (!statSync(fullPath).isDirectory()) continue;
      if (!existsSync(path.join(fullPath, "level.dat"))) continue;

      const isRunning = existsSync(path.join(fullPath, "session.lock"));
      await backupWorldToDrive(server.id, server.name, entry, fullPath, isRunning);
    }
  }
}

export async function backupWorldToDrive(
  serverId: string,
  serverName: string,
  worldName: string,
  worldPath: string,
  isRunning: boolean = false
): Promise<{ success: boolean; error?: string }> {
  const driveStatus = getDriveStatus();
  if (!driveStatus.authenticated) {
    return { success: false, error: "Drive not authenticated" };
  }

  const backupsDir = path.join(BACKUPS_DIR, serverId);
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${serverName}-${worldName}-${timestamp}.zip`;
  const zipPath = path.join(backupsDir, filename);

  // Zip the world
  let tempDir: string | null = null;
  try {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    if (isRunning) {
      // Live backup: first copy readable files to temp dir, then zip temp
      // This avoids EBUSY on region files locked by the Minecraft server
      tempDir = path.join(backupsDir, `.tmp-${serverId}-${timestamp}`);
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      mkdirSync(tempDir, { recursive: true });

      await copyReadable(worldPath, tempDir);
      archive.directory(tempDir, worldName);
    } else {
      archive.directory(worldPath, worldName);
    }

    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.finalize();
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (tempDir && existsSync(tempDir)) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  // Upload to Drive
  const result = await uploadBackupToDrive(serverName, zipPath, filename);

  // Clean local zip (optional, keep if drive upload fails)
  if (result.success) {
    try { unlinkSync(zipPath); } catch {}
  }

  return result;
}
