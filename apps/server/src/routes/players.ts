// MC Server GUI
import { Router, Request, Response } from "express";
import path from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { loadServer, getServerDir } from "../services/DataStore.js";
import { getOnlinePlayers, sendCommand } from "../services/ServerManager.js";
import type { PlayerEntry } from "@mcservergui/shared";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

function readPlayerList(serverDir: string, filename: string): PlayerEntry[] {
  const filePath = path.join(serverDir, filename);
  if (!existsSync(filePath)) return [];

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

function writePlayerList(serverDir: string, filename: string, entries: PlayerEntry[]): void {
  const filePath = path.join(serverDir, filename);
  writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf-8");
}

router.get("/:serverId/players", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const serverDir = getServerDir(serverId);

  res.json({
    online: getOnlinePlayers(serverId),
    whitelist: readPlayerList(serverDir, "whitelist.json"),
    ops: readPlayerList(serverDir, "ops.json"),
    bannedPlayers: readPlayerList(serverDir, "banned-players.json"),
    bannedIps: readPlayerList(serverDir, "banned-ips.json"),
  });
});

// Kick player
router.post("/:serverId/players/:name/kick", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const name = p(req.params, "name");
  const result = sendCommand(serverId, `kick ${name}`);
  res.json({ success: result.success, error: result.error });
});

// Ban player
router.post("/:serverId/players/:name/ban", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const name = p(req.params, "name");
  const result = sendCommand(serverId, `ban ${name}`);
  res.json({ success: result.success, error: result.error });
});

// Op player
router.post("/:serverId/players/:name/op", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const name = p(req.params, "name");
  const result = sendCommand(serverId, `op ${name}`);
  res.json({ success: result.success, error: result.error });
});

// Deop player
router.post("/:serverId/players/:name/deop", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const name = p(req.params, "name");
  const result = sendCommand(serverId, `deop ${name}`);
  res.json({ success: result.success, error: result.error });
});

router.put("/:serverId/players/whitelist", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { entries } = req.body;
  if (!Array.isArray(entries)) {
    res.status(400).json({ error: "entries array is required" });
    return;
  }

  writePlayerList(getServerDir(serverId), "whitelist.json", entries);
  res.json({ success: true });
});

router.put("/:serverId/players/ops", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { entries } = req.body;
  if (!Array.isArray(entries)) {
    res.status(400).json({ error: "entries array is required" });
    return;
  }

  const serverDir = getServerDir(serverId);
  const opsWithLevel = entries.map((e: any) => ({
    uuid: e.uuid,
    name: e.name,
    level: e.level || 4,
    bypassesPlayerLimit: e.bypassesPlayerLimit || false,
  }));
  writeFileSync(
    path.join(serverDir, "ops.json"),
    JSON.stringify(opsWithLevel, null, 2),
    "utf-8"
  );
  res.json({ success: true });
});

export { router as playersRouter };

