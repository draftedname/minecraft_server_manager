import { Router, Request, Response } from "express";
import path from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { loadServer, getServerDir } from "../services/DataStore.js";
import { getOnlinePlayers, sendCommand } from "../services/ServerManager.js";
import type { PlayerEntry, UpdateOpsRequest, UpdatePlayerListRequest } from "@mcservergui/shared";

const router = Router();

import { p } from "../lib/params.js";

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

const NAME_RE = /^[a-zA-Z0-9_]{1,16}$/;

function playerRoute(command: (name: string) => string) {
  return (req: Request, res: Response) => {
    const serverId = p(req.params, "serverId");
    const name = p(req.params, "name");
    if (!NAME_RE.test(name)) {
      res.status(400).json({ error: "Invalid player name" });
      return;
    }
    const result = sendCommand(serverId, command(name));
    res.json({ success: result.success, error: result.error });
  };
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

router.post("/:serverId/players/:name/kick", playerRoute((n) => `kick ${n}`));
router.post("/:serverId/players/:name/ban", playerRoute((n) => `ban ${n}`));
router.post("/:serverId/players/:name/op", playerRoute((n) => `op ${n}`));
router.post("/:serverId/players/:name/deop", playerRoute((n) => `deop ${n}`));
router.post("/:serverId/players/:name/unban", playerRoute((n) => `pardon ${n}`));

router.post("/:serverId/players/:name/unban-ip", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const ip = p(req.params, "name");
  if (!/^[\d.:]+$/.test(ip)) {
    res.status(400).json({ error: "Invalid IP address" });
    return;
  }
  const result = sendCommand(serverId, `pardon-ip ${ip}`);
  res.json({ success: result.success, error: result.error });
});

router.put("/:serverId/players/whitelist", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { entries } = req.body as UpdatePlayerListRequest;
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

  const { entries } = req.body as UpdateOpsRequest;
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
