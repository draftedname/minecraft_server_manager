import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { v4 as uuid } from "uuid";
import { loadServers, addServer, removeServer, loadServer, ensureServerDir, saveServers, updateServer, getServerDir } from "../services/DataStore.js";
import { startServer, stopServer, restartServer, sendCommand, getServerInfo, getRunningServer } from "../services/ServerManager.js";
import { downloadVanillaJar, downloadFabricJar } from "../services/ServerJarDownloader.js";
import { checkJava } from "../services/JavaManager.js";
import { SERVERS_DIR } from "../services/config.js";
import { getIO } from "../websocket/index.js";
import { readLastLines } from "../services/readLastLines.js";
import { installModpack } from "../services/ModpackInstaller.js";
import { asyncHandler } from "../lib/asyncHandler.js";
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
router.post("/", asyncHandler(async (req: Request, res: Response) => {
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

  try {
    if (body.type === "vanilla") {
      await downloadVanillaJar(getServerDir(id), body.gameVersion!);
    } else if (body.type === "fabric") {
      await downloadFabricJar(getServerDir(id), body.gameVersion!, body.loaderVersion!);
    } else if (body.type === "modpack") {
      const { getVersion, downloadModFile } = await import("../services/ModrinthClient.js");
      const io = getIO();
      const emit = (msg: string, current: number, total: number) => {
        io?.emit("download:progress", { message: msg, current, total });
      };

      emit("Fetching modpack info...", 0, 1);

      const result = await installModpack(dir, String(body.modpackVersionId), emit, body.loaderVersion || undefined);
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
}));

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

// Delete server
router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = p(req.params, "id");

  if (getRunningServer(id)) {
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
}));

// Start server
router.post("/:id/start", asyncHandler(async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const result = await startServer(id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
}));

// Stop server
router.post("/:id/stop", asyncHandler(async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const result = await stopServer(id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
}));

// Restart server
router.post("/:id/restart", asyncHandler(async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const result = await restartServer(id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
}));

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

// Rename server
router.put("/:id/name", asyncHandler(async (req: Request, res: Response) => {
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
}));

// Update loader version (re-downloads fabric loader and libraries)
router.put("/:id/loader", asyncHandler(async (req: Request, res: Response) => {
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
}));

// Update server RAM allocation
router.put("/:id/ram", asyncHandler(async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const config = loadServer(id);
  if (!config) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  if (getRunningServer(id)) {
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
}));

export { router as serversRouter };
