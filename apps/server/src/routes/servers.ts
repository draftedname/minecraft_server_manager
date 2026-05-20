import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { v4 as uuid } from "uuid";
import { loadServers, addServer, removeServer, loadServer, ensureServerDir, saveServers, updateServer } from "../services/DataStore.js";
import { startServer, stopServer, restartServer, sendCommand, getServerInfo, getAllRunning, getRunningServer } from "../services/ServerManager.js";
import { downloadVanillaJar, downloadFabricJar } from "../services/ServerJarDownloader.js";
import { checkJava } from "../services/JavaManager.js";
import { SERVERS_DIR } from "../services/config.js";
import { getIO } from "../websocket/index.js";
import { copyDirAsync } from "../services/FileUtils.js";
import type { ServerConfig, CreateServerRequest } from "@mcservergui/shared";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

// List all servers
router.get("/", (_req: Request, res: Response) => {
  let servers = loadServers();
  const valid: ServerConfig[] = [];
  let cleaned = false;

  for (const s of servers) {
    if (existsSync(path.join(SERVERS_DIR, s.id))) {
      valid.push(s);
    } else {
      cleaned = true;
    }
  }

  if (cleaned) {
    saveServers(valid);
  }

  res.json(valid);
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
    autoStart: false,
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
      await downloadVanillaJar(id, body.gameVersion!);
    } else if (body.type === "fabric") {
      await downloadFabricJar(id, body.gameVersion!, body.loaderVersion!);
    } else if (body.type === "modpack") {
      const { getVersion, downloadModFile } = await import("../services/ModrinthClient.js");
      const io = getIO();
      const emit = (msg: string, current: number, total: number) => {
        io?.emit("download:progress", { message: msg, current, total });
      };

      emit("Fetching modpack info...", 0, 1);

      const version = await getVersion(String(body.modpackVersionId));
      const mrpackFile = version?.files?.find((f: any) => f.filename?.endsWith(".mrpack"));
      if (!mrpackFile) throw new Error("No .mrpack file found for this modpack version");

      const mrpackPath = path.join(dir, "pack.mrpack");
      emit("Downloading modpack file...", 0, 1);
      await downloadModFile(mrpackFile.url, mrpackPath);

      const extractDir = path.join(dir, ".pack-extract");
      if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });

      emit("Extracting modpack...", 1, 1);
      const { default: extract } = await import("extract-zip");
      await extract(mrpackPath, { dir: extractDir });

      const manifestPath = path.join(extractDir, "modrinth.index.json");
      if (!existsSync(manifestPath)) throw new Error("modrinth.index.json not found");

      const { readFileSync } = await import("fs");
      const manifestData = JSON.parse(readFileSync(manifestPath, "utf-8"));

      const gameVer = (manifestData.dependencies?.minecraft || manifestData.versionId).replace(/^v/, "");
      const loaderType = manifestData.dependencies?.["fabric-loader"] ? "fabric" : "vanilla";
      const loaderVer = manifestData.dependencies?.["fabric-loader"];

      console.log(`Modpack: ${manifestData.name}, MC ${gameVer}, loader: ${loaderType} ${loaderVer || ""}`);

      emit("Downloading server jar...", 1, 3);
      if (loaderType === "fabric" && loaderVer) {
        await downloadFabricJar(id, gameVer, loaderVer);
      } else {
        await downloadVanillaJar(id, gameVer);
      }

      const modsDir = path.join(dir, "mods");
      if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true });

      const files = manifestData.files || [];
      console.log(`Downloading ${files.length} mods...`);
      let done = 0;
      for (const file of files) {
        done++;
        emit(`Downloading mods (${done}/${files.length})...`, done, files.length + 2);
        if (!file.downloads?.[0]) continue;
        const filePath = path.join(dir, file.path);
        const fileDir = path.dirname(filePath);
        if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
        try {
          await downloadModFile(file.downloads[0], filePath);
        } catch (e: any) {
          console.log(`  Failed: ${file.path} - ${e.message}`);
        }
      }

      const overridesDir = path.join(extractDir, "overrides");
      if (existsSync(overridesDir)) {
        await copyDirAsync(overridesDir, dir);
      }

      rmSync(extractDir, { recursive: true, force: true });
      try { (await import("fs")).unlinkSync(mrpackPath); } catch {}

      config.gameVersion = gameVer;
      config.loaderVersion = loaderVer;

      emit("Complete!", 1, 1);
    }
  } catch (err: any) {
    console.error("Server creation failed:", err.message);
    res.status(500).json({ error: err.message });
    return;
  }

  addServer(config);
  res.status(201).json(config);
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

// Delete server
router.delete("/:id", (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const removed = removeServer(id);
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

// Restart server
router.post("/:id/restart", async (req: Request, res: Response) => {
  const id = p(req.params, "id");
  const result = await restartServer(id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
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

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter(Boolean).slice(-1000);
    res.json({ lines });
  } catch {
    res.json({ lines: [] });
  }
});

// Update server RAM allocation
router.put("/:id/ram", (req: Request, res: Response) => {
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
  updateServer(id, { ram });
  res.json({ success: true, ram });
});

export { router as serversRouter };
