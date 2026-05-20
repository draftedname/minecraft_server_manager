import { Router, Request, Response } from "express";
import path from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { loadServer, getServerDir } from "../services/DataStore.js";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

const PROPERTY_DEFINITIONS: Record<string, { type: string; description: string; category: string; options?: string[] }> = {
  "allow-flight": { type: "boolean", description: "Allows users to use flight on your server", category: "server" },
  "allow-nether": { type: "boolean", description: "Allows players to travel to the Nether", category: "world" },
  "broadcast-console-to-ops": { type: "boolean", description: "Send console command outputs to online operators", category: "server" },
  "broadcast-rcon-to-ops": { type: "boolean", description: "Send rcon command outputs to online operators", category: "server" },
  "difficulty": { type: "select", description: "Sets the difficulty of the server", category: "server", options: ["peaceful", "easy", "normal", "hard"] },
  "enable-command-block": { type: "boolean", description: "Enables command blocks", category: "server" },
  "enable-jmx-monitoring": { type: "boolean", description: "Expose JMX monitoring", category: "server" },
  "enable-query": { type: "boolean", description: "Enables GameSpy server listener", category: "network" },
  "enable-rcon": { type: "boolean", description: "Enables remote access to server console", category: "network" },
  "enable-status": { type: "boolean", description: "Makes the server appear in the server list", category: "network" },
  "enforce-secure-profile": { type: "boolean", description: "Requires secure profiles for connecting players", category: "server" },
  "enforce-whitelist": { type: "boolean", description: "Enforce whitelist on the server", category: "server" },
  "force-gamemode": { type: "boolean", description: "Force players to join in the default game mode", category: "server" },
  "gamemode": { type: "select", description: "Defines the default game mode", category: "server", options: ["survival", "creative", "adventure", "spectator"] },
  "generate-structures": { type: "boolean", description: "Generate structures", category: "world" },
  "generator-settings": { type: "text", description: "Customize world generation", category: "world" },
  "hardcore": { type: "boolean", description: "Hardcore mode (death = ban)", category: "server" },
  "hide-online-players": { type: "boolean", description: "Hide online players in server list", category: "network" },
  "level-name": { type: "text", description: "Name of the world folder", category: "world" },
  "level-seed": { type: "text", description: "Seed for world generation", category: "world" },
  "level-type": { type: "select", description: "World generation type", category: "world", options: ["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified"] },
  "max-build-height": { type: "number", description: "Maximum build height", category: "world" },
  "max-chained-neighbor-updates": { type: "number", description: "Max neighboring block updates per tick", category: "server" },
  "max-players": { type: "number", description: "Maximum players allowed on the server", category: "server" },
  "max-tick-time": { type: "number", description: "Max time for a tick in ms before watchdog", category: "server" },
  "max-world-size": { type: "number", description: "Maximum world size border", category: "world" },
  "motd": { type: "text", description: "Message of the day displayed in server list", category: "network" },
  "network-compression-threshold": { type: "number", description: "Packet compression threshold", category: "network" },
  "online-mode": { type: "boolean", description: "Authenticate players with Mojang servers", category: "server" },
  "op-permission-level": { type: "number", description: "Default operator permission level", category: "server" },
  "player-idle-timeout": { type: "number", description: "Minutes before kicking idle players", category: "server" },
  "prevent-proxy-connections": { type: "boolean", description: "Prevent proxy/VPN connections", category: "network" },
  "pvp": { type: "boolean", description: "Enable PvP", category: "server" },
  "query.port": { type: "number", description: "GameSpy query port", category: "network" },
  "rcon.password": { type: "text", description: "RCON password", category: "network" },
  "rcon.port": { type: "number", description: "RCON port", category: "network" },
  "server-ip": { type: "text", description: "IP to bind to (leave empty for all)", category: "network" },
  "server-port": { type: "number", description: "Server port", category: "network" },
  "simulation-distance": { type: "number", description: "Simulation distance in chunks", category: "server" },
  "spawn-animals": { type: "boolean", description: "Spawn animals", category: "world" },
  "spawn-monsters": { type: "boolean", description: "Spawn monsters", category: "world" },
  "spawn-npcs": { type: "boolean", description: "Spawn villagers", category: "world" },
  "spawn-protection": { type: "number", description: "Spawn protection radius", category: "server" },
  "sync-chunk-writes": { type: "boolean", description: "Sync chunk writes to disk", category: "server" },
  "text-filtering-config": { type: "text", description: "Text filtering configuration", category: "server" },
  "use-native-transport": { type: "boolean", description: "Linux: use epoll transport", category: "server" },
  "view-distance": { type: "number", description: "View distance in chunks", category: "server" },
  "white-list": { type: "boolean", description: "Enable whitelist", category: "server" },
};

const PROPERTY_CATEGORIES = [
  { key: "server", label: "Server" },
  { key: "world", label: "World" },
  { key: "network", label: "Network" },
];

function readProperties(serverDir: string): Record<string, string> {
  const propsPath = path.join(serverDir, "server.properties");
  if (!existsSync(propsPath)) return {};

  const content = readFileSync(propsPath, "utf-8");
  const props: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    props[key] = val;
  }

  return props;
}

function writeProperties(serverDir: string, props: Record<string, string>): void {
  const propsPath = path.join(serverDir, "server.properties");
  const lines: string[] = [];

  for (const key of Object.keys(PROPERTY_DEFINITIONS)) {
    if (key in props) {
      lines.push(`${key}=${props[key]}`);
    }
  }

  for (const [key, value] of Object.entries(props)) {
    if (!(key in PROPERTY_DEFINITIONS)) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(propsPath, lines.join("\n") + "\n", "utf-8");
}

router.get("/:serverId/properties", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const serverDir = getServerDir(serverId);
  const props = readProperties(serverDir);

  if (Object.keys(props).length === 0) {
    const defaults: Record<string, string> = {};
    for (const [key, def] of Object.entries(PROPERTY_DEFINITIONS)) {
      if (def.type === "boolean") defaults[key] = "true";
      else if (def.type === "number") defaults[key] = "0";
      else if (def.type === "select" && def.options) defaults[key] = def.options[0];
      else defaults[key] = "";
    }
    res.json({ properties: defaults, definitions: PROPERTY_DEFINITIONS, categories: PROPERTY_CATEGORIES });
    return;
  }

  res.json({ properties: props, definitions: PROPERTY_DEFINITIONS, categories: PROPERTY_CATEGORIES });
});

router.put("/:serverId/properties", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { properties } = req.body;
  if (!properties || typeof properties !== "object") {
    res.status(400).json({ error: "properties object is required" });
    return;
  }

  const serverDir = getServerDir(serverId);
  writeProperties(serverDir, properties);
  res.json({ success: true });
});

router.get("/:serverId/eula", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const eulaPath = path.join(getServerDir(serverId), "eula.txt");
  const accepted = existsSync(eulaPath) && readFileSync(eulaPath, "utf-8").includes("eula=true");
  res.json({ accepted });
});

router.put("/:serverId/eula", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const eulaPath = path.join(getServerDir(serverId), "eula.txt");
  writeFileSync(eulaPath, "eula=true", "utf-8");
  res.json({ accepted: true });
});

export { router as settingsRouter };
