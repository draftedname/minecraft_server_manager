export interface ServerConfig {
  id: string;
  name: string;
  type: "vanilla" | "fabric" | "modpack";
  gameVersion: string;
  loaderVersion?: string;
  /** Memory in MB */
  ram: number;
  javaPath: string;
  createdAt: string;
  lastStartedAt: string | null;
  backupConfig: BackupConfig;
  modpackId?: string;
  modpackVersionId?: string;
}

export interface BackupConfig {
  enabled: boolean;
  /** Interval in minutes */
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
  /** Uptime in milliseconds */
  uptime: number;
}

export interface CreateServerRequest {
  name: string;
  type: "vanilla" | "fabric" | "modpack";
  gameVersion: string;
  loaderVersion?: string;
  /** Memory in MB */
  ram: number;
  modpackId?: string;
  modpackVersionId?: string;
  includeFiles?: string[];
}

export interface JavaInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface ModInfo {
  filename: string;
  /** Size in bytes */
  size: number;
  enabled: boolean;
  modrinthId: string | null;
  name: string | null;
  version: string | null;
}

export interface WorldInfo {
  name: string;
  /** Size in bytes */
  size: number;
  lastModified: string;
  isActive: boolean;
}

export interface BackupMeta {
  id: string;
  worldName: string;
  serverId: string;
  /** Size in bytes */
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

export interface UploadInitRequest {
  filename: string;
  totalChunks: number;
}

export interface ModpackInstallRequest {
  versionId: string;
  modpackId?: string;
  includeFiles?: string[];
}

export interface ModInstallRequest {
  versionId: string;
  projectId: string;
}

export interface WorldImportRequest {
  zipPath: string;
}

export interface WorldRestoreRequest {
  backupId: string;
  worldName: string;
}

export interface UpdateOpsRequest {
  entries: Array<{
    uuid: string;
    name: string;
    level?: number;
    bypassesPlayerLimit?: boolean;
  }>;
}

export interface UpdatePlayerListRequest {
  entries: PlayerEntry[];
}
