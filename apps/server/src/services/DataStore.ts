// MC Server GUI
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { SERVERS_FILE, SERVERS_DIR } from "./config.js";
import type { ServerConfig } from "@mcservergui/shared";

const DEFAULT_PROPERTIES = [
  "server-port=25565",
  "gamemode=survival",
  "difficulty=easy",
  "max-players=20",
  "view-distance=10",
  "simulation-distance=10",
  "motd=A Minecraft Server",
  "online-mode=true",
  "allow-flight=false",
  "allow-nether=true",
  "enable-command-block=false",
  "spawn-animals=true",
  "spawn-monsters=true",
  "spawn-npcs=true",
  "pvp=true",
  "generate-structures=true",
  "level-name=world",
  "level-type=minecraft\\:normal",
  "enable-query=false",
  "enable-rcon=false",
  "white-list=false",
  "enforce-whitelist=false",
  "broadcast-console-to-ops=true",
  "prevent-proxy-connections=false",
  "use-native-transport=true",
  "sync-chunk-writes=true",
].join("\n") + "\n";

export function loadServers(): ServerConfig[] {
  if (!existsSync(SERVERS_FILE)) return [];
  const raw = readFileSync(SERVERS_FILE, "utf-8");
  return JSON.parse(raw);
}

export function saveServers(servers: ServerConfig[]): void {
  writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2), "utf-8");
}

export function loadServer(id: string): ServerConfig | null {
  const servers = loadServers();
  return servers.find((s) => s.id === id) || null;
}

export function addServer(config: ServerConfig): void {
  const servers = loadServers();
  servers.push(config);
  saveServers(servers);
}

export function updateServer(id: string, updates: Partial<ServerConfig>): ServerConfig | null {
  const servers = loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  servers[idx] = { ...servers[idx], ...updates };
  saveServers(servers);
  return servers[idx];
}

export function removeServer(id: string): boolean {
  const servers = loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  servers.splice(idx, 1);
  saveServers(servers);
  return true;
}

export function ensureServerDir(id: string): string {
  const dir = path.join(SERVERS_DIR, id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(dir, "mods"), { recursive: true });
    mkdirSync(path.join(dir, "logs"), { recursive: true });
    writeFileSync(path.join(dir, "server.properties"), DEFAULT_PROPERTIES, "utf-8");
    writeFileSync(path.join(dir, "eula.txt"), "eula=true", "utf-8");
  }
  return dir;
}

export function getServerDir(id: string): string {
  return path.join(SERVERS_DIR, id);
}

