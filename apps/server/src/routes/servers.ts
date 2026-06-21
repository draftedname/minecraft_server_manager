import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync, unlinkSync } from "fs";
import { v4 as uuid } from "uuid";
import { loadServers, addServer, removeServer, loadServer, ensureServerDir, saveServers, updateServer, getServerDir } from "../services/DataStore.js";
import { startServer, stopServer, restartServer, restartServerAsync, sendCommand, getServerInfo, getRunningServer } from "../services/ServerManager.js";
import { downloadVanillaJar, downloadFabricJar } from "../services/ServerJarDownloader.js";
import { checkJava } from "../services/JavaManager.js";
import { SERVERS_DIR } from "../services/config.js";
import { getIO } from "../websocket/index.js";
import { readLastLines } from "../services/readLastLines.js";
import { analyzeLogFile, readServerLog } from "../services/LogAnalyzer.js";
import { installModpack } from "../services/ModpackInstaller.js";
import { getLatestCompatibleVersion, downloadModFile } from "../services/ModrinthClient.js";
import { loadModMeta, saveModMeta, getMetaPath } from "./mods.js";
import type { ServerConfig, CreateServerRequest } from "@mcservergui/shared";

const router = Router();

import { p } from "../lib/params.js";

// List all servers
router.get("/", (req: Request, res: Response) => {
  const valid = loadServers();
  if (req.query.status === "true") {
    res.json(valid.map((c) => getServerInfo(c.id)).filter(Boolean));
  } else {
    res.json(valid);
  }
});

// Create server
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as CreateServerRequest;

  if (!body.name || !body.type) {
    res.status(400).json({ error: "Name and type are required" });
    return;
  }

  if (body.type === "fabric" && !body.loaderVersion) {
    res.status(400).json({ error: "Loader version required for Fabric" });
    return;
  }

  if (body.type === "modpack" && !body.modpackId) {
    res.status(400).json({ error: "modpackId is required for modpack servers" });
    return;
  }

  if (body.type !== "modpack" && !body.gameVersion) {
    res.status(400).json({ error: "gameVersion is required" });
    return;
  }

  const javaInfo = checkJava();

  // Create readable folder name: my-server-name-a1b2c3d4
  const slug = body.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);
  const shortId = uuid().split("-")[0].substring(0, 8);
  const id = slug ? `${slug}-${shortId}` : shortId;

  const config: ServerConfig = {
    id,
    name: body.name,
    type: body.type,
    gameVersion: body.gameVersion || "",
    loaderVersion: body.loaderVersion,
    ram: body.ram || 2048,
    javaPath: javaInfo.path || "java",
    createdAt: new Date().toISOString(),
    lastStartedAt: null,
    modpackId: body.modpackId,
    modpackVersionId: body.modpackVersionId,
    backupConfig: {
      enabled: false,
      intervalMinutes: 360,
      onStop: true,
      driveFolderId: null,
      maxBackups: 10,
    },
  };

  const dir = ensureServerDir(id);

  // Ensure EULA prompt shows on first start
  writeFileSync(path.join(dir, "eula.txt"), "eula=false", "utf-8");

  try {
    if (body.type === "vanilla") {
      await downloadVanillaJar(getServerDir(id), body.gameVersion!);
    } else if (body.type === "fabric") {
      await downloadFabricJar(getServerDir(id), body.gameVersion!, body.loaderVersion!);
    } else if (body.type === "modpack") {
      const io = getIO();
      const emit = (msg: string, current: number, total: number) => {
        io?.emit("download:progress", { message: msg, current, total });
      };

      emit("Fetching modpack info...", 0, 1);

      const includeFiles = body.includeFiles?.length ? new Set<string>(body.includeFiles) : undefined;
      const result = await installModpack(dir, String(body.modpackVersionId), emit, body.loaderVersion || undefined, includeFiles);
      config.gameVersion = result.gameVersion;
      config.loaderVersion = result.loaderVersion || config.loaderVersion;
      if (result.name && result.gameVersion) {
        config.name = `${result.name} - ${result.gameVersion}`;
      }
    }

    await addServer(config);
    res.status(201).json(config);
  } catch (err: any) {
    console.error("Server creation failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get server details
router.get("/:id", (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const info = getServerInfo(id);
  if (!info) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(info);
});

// Clone server
router.post("/:id/clone", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config) { res.status(404).json({ error: "Server not found" }); return; }

  const shortId = uuid().split("-")[0].substring(0, 8);
  const newId = id.split("-").slice(0, -1).join("-") + "-" + shortId;

  const newConfig: ServerConfig = {
    ...config,
    id: newId,
    name: `${config.name} (Clone)`,
    createdAt: new Date().toISOString(),
    lastStartedAt: null,
  };

  const srcPath = getServerDir(id);
  const destPath = ensureServerDir(newId);

  if (existsSync(srcPath)) {
    cpSync(srcPath, destPath, { recursive: true, force: true });
  }

  await addServer(newConfig);
  res.status(201).json(newConfig);
});

// Delete server
router.delete("/:id", async (req: Request, res: Response) => {
  const id = p(req.params, "id");

  const running = getRunningServer(id);
  if (running && running.status !== "crashed") {
    res.status(400).json({ error: "Server is running. Stop it before deleting." });
    return;
  }

  const removed = await removeServer(id);
  if (!removed) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const serverDir = path.join(SERVERS_DIR, id);
  if (existsSync(serverDir)) {
    rmSync(serverDir, { recursive: true, force: true });
  }
  res.json({ success: true });
});

// Start server
router.post("/:id/start", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const result = await startServer(id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

// Stop server
router.post("/:id/stop", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const result = await stopServer(id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

// Restart server (non-blocking — responds immediately, polls in background)
router.post("/:id/restart", (req: Request, res: Response) => {
  const id = p(req.params, "id");
  restartServerAsync(id);
  res.json({ success: true });
});

// Send command
router.post("/:id/command", (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const { command } = req.body;
  if (!command) {
    res.status(400).json({ error: "Command is required" });
    return;
  }
  const result = sendCommand(id, command);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

// Get latest.log content for console history
router.get("/:id/console-history", (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const serverDir = path.join(SERVERS_DIR, id);
  const logPath = path.join(serverDir, "logs", "latest.log");

  if (!existsSync(logPath)) {
    res.json({ lines: [] });
    return;
  }

  const lines = readLastLines(logPath, 1000);
  res.json({ lines });
});

// Accept EULA
router.post("/:id/eula/accept", (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config) { res.status(404).json({ error: "Server not found" }); return; }
  const eulaPath = path.join(SERVERS_DIR, id, "eula.txt");
  writeFileSync(eulaPath, "eula=true", "utf-8");
  res.json({ success: true });
});

// Analyze server log via mclo.gs
router.post("/:id/log-analyze", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const logContent = readServerLog(id);
  if (!logContent) {
    res.json({ analysis: null, note: "No log file found" });
    return;
  }
  const result = await analyzeLogFile(logContent);
  res.json(result);
});

// Rename server
router.put("/:id/name", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const updated = await updateServer(id, { name });
  if (!updated) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json({ success: true, name });
});

// Update loader version (re-downloads fabric loader and libraries)
router.put("/:id/loader", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const { loaderVersion } = req.body;
  if (!loaderVersion) {
    res.status(400).json({ error: "loaderVersion is required" });
    return;
  }
  const config = loadServer(id);
  if (!config) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  if (getRunningServer(id)) {
    res.status(400).json({ error: "Server must be stopped to change the loader version" });
    return;
  }
  await downloadFabricJar(getServerDir(id), config.gameVersion, loaderVersion);
  const updated = await updateServer(id, { loaderVersion });
  res.json({ success: true, loaderVersion });
});

// Update server RAM allocation
router.put("/:id/ram", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const running = getRunningServer(id);
  if (running && running.status !== "crashed") {
    res.status(400).json({ error: "Server must be stopped to change RAM" });
    return;
  }
  const ram = parseInt(req.body.ram, 10);
  if (isNaN(ram) || ram < 512 || ram > 32768) {
    res.status(400).json({ error: "RAM must be between 512 and 32768 MB" });
    return;
  }
  await updateServer(id, { ram });
  res.json({ success: true, ram });
});

// Update server game version (Vanilla only)
router.post("/:id/update-version", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  if (config.type !== "vanilla") {
    res.status(400).json({ error: "Version updates are only supported for Vanilla servers." });
    return;
  }
  const running = getRunningServer(id);
  if (running && running.status !== "crashed") {
    res.status(400).json({ error: "Server must be stopped to update version." });
    return;
  }
  const targetVersion = req.body.targetVersion;
  if (!targetVersion || typeof targetVersion !== "string") {
    res.status(400).json({ error: "targetVersion is required" });
    return;
  }
  try {
    await downloadVanillaJar(getServerDir(id), targetVersion);
    const updated = await updateServer(id, { gameVersion: targetVersion });
    res.json({ success: true, server: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fabric Server Pre-flight
router.post("/:id/update-fabric/preflight", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config || config.type !== "fabric") {
    res.status(404).json({ error: "Fabric Server not found" });
    return;
  }
  
  const { targetVersion } = req.body;
  if (!targetVersion) {
    res.status(400).json({ error: "targetVersion is required" });
    return;
  }

  try {
    const meta = loadModMeta(id);
    const upgradable = [];
    const incompatible = [];

    for (const [filename, modMeta] of Object.entries(meta)) {
      if (!modMeta.projectId) continue;
      
      const latest = await getLatestCompatibleVersion(modMeta.projectId, targetVersion, "fabric");
      if (latest && latest.files && latest.files[0]) {
        upgradable.push({
          oldFilename: filename,
          newFilename: latest.files[0].filename,
          projectId: modMeta.projectId,
          versionId: latest.id,
          versionNumber: latest.version_number,
          gameVersions: latest.game_versions || [],
          url: latest.files[0].url,
        });
      } else {
        incompatible.push({
          filename,
          projectId: modMeta.projectId,
        });
      }
    }
    
    res.json({ upgradable, incompatible });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fabric Server Execute Update
router.post("/:id/update-fabric/execute", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config || config.type !== "fabric") {
    res.status(404).json({ error: "Fabric Server not found" });
    return;
  }
  
  const running = getRunningServer(id);
  if (running && running.status !== "crashed") {
    res.status(400).json({ error: "Server must be stopped to update version." });
    return;
  }

  const { targetVersion, targetLoaderVersion, incompatibleAction, upgradable, incompatible } = req.body;
  if (!targetVersion || !targetLoaderVersion) {
    res.status(400).json({ error: "targetVersion and targetLoaderVersion are required" });
    return;
  }

  try {
    const modsDir = path.join(getServerDir(id), "mods");
    const metaPath = getMetaPath(id);

    // 1. Download Core
    await downloadFabricJar(getServerDir(id), targetVersion, targetLoaderVersion);

    // 2. Process Upgradable
    for (const mod of upgradable) {
      const dest = path.join(modsDir, mod.newFilename);
      await downloadModFile(mod.url, dest);

      // Remove old files
      const oldPath = path.join(modsDir, mod.oldFilename);
      const oldDisabledPath = oldPath + ".disabled";
      if (existsSync(oldPath)) unlinkSync(oldPath);
      if (existsSync(oldDisabledPath)) unlinkSync(oldDisabledPath);

      // Save new meta
      saveModMeta(id, mod.newFilename, {
        projectId: mod.projectId,
        versionId: mod.versionId,
        versionNumber: mod.versionNumber,
        installedAt: new Date().toISOString(),
        gameVersions: mod.gameVersions,
      });

      // Remove old meta if name changed
      if (mod.oldFilename !== mod.newFilename) {
        const allMeta = loadModMeta(id);
        delete allMeta[mod.oldFilename];
        writeFileSync(metaPath, JSON.stringify(allMeta, null, 2), "utf-8");
      }
    }

    // 3. Process Incompatible
    for (const mod of incompatible) {
      const modPath = path.join(modsDir, mod.filename);
      const disabledPath = modPath + ".disabled";

      if (incompatibleAction === "delete") {
        if (existsSync(modPath)) unlinkSync(modPath);
        if (existsSync(disabledPath)) unlinkSync(disabledPath);
        const allMeta = loadModMeta(id);
        delete allMeta[mod.filename];
        writeFileSync(metaPath, JSON.stringify(allMeta, null, 2), "utf-8");
      } else if (incompatibleAction === "disable") {
        if (existsSync(modPath)) {
          import("fs").then(fs => fs.renameSync(modPath, disabledPath));
        }
      }
    }

    const updated = await updateServer(id, { gameVersion: targetVersion, loaderVersion: targetLoaderVersion });
    res.json({ success: true, server: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as serversRouter };
