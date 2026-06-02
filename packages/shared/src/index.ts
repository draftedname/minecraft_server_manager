export interface ServerConfig {
  id: string;
  name: string;
  type: "vanilla" | "fabric" | "modpack";
  gameVersion: string;
  loaderVersion?: string;
  ram: number;
  javaPath: string;
  autoStart: boolean;
  createdAt: string;
  lastStartedAt: string | null;
  backupConfig: BackupConfig;
  modpackId?: string;
  modpackVersionId?: string;
}

export interface BackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  onStop: boolean;
  driveFolderId: string | null;
  maxBackups: number;
}

export type ServerStatus = "stopped" | "running" | "starting" | "stopping" | "crashed";

export interface ServerInfo {
  config: ServerConfig;
  status: ServerStatus;
  pid: number | null;
  uptime: number;
}

export interface CreateServerRequest {
  name: string;
  type: "vanilla" | "fabric" | "modpack";
  gameVersion: string;
  loaderVersion?: string;
  ram: number;
  modpackId?: string;
  modpackVersionId?: string;
}

export interface JavaInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface ModInfo {
  filename: string;
  size: number;
  enabled: boolean;
  modrinthId: string | null;
  name: string | null;
  version: string | null;
}

export interface WorldInfo {
  name: string;
  size: number;
  lastModified: string;
  isActive: boolean;
}

export interface BackupMeta {
  id: string;
  worldName: string;
  serverId: string;
  size: number;
  createdAt: string;
  drive: boolean;
}

export interface PlayerList {
  type: "whitelist" | "ops" | "banned-players" | "banned-ips";
  entries: PlayerEntry[];
}

export interface PlayerEntry {
  uuid: string;
  name: string;
}
