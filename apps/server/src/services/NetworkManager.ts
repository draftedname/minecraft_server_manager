// MC Server GUI
import { spawn, ChildProcess, execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { getIO } from "../websocket/index.js";
import { DATA_DIR } from "./config.js";

const PLAYIT_DIR = path.join(DATA_DIR, "playit");
const PLAYIT_BIN = path.join(PLAYIT_DIR, process.platform === "win32" ? "playit.exe" : "playit");

interface NetworkState {
  enabled: boolean;
  mode: "playit" | "none";
  address: string | null;
  playitClaimUrl: string | null;
  playitLinked: boolean;
  usePlayit: boolean;
  error: string | null;
}

const networkStates = new Map<string, NetworkState>();
const playitProcesses = new Map<string, ChildProcess>();

function ensurePlayitDir() {
  if (!existsSync(PLAYIT_DIR)) mkdirSync(PLAYIT_DIR, { recursive: true });
}

function getPlayitBin(): string {
  return PLAYIT_BIN;
}

export function isPlayitInstalled(): boolean {
  return existsSync(getPlayitBin());
}

async function downloadPlayit(): Promise<void> {
  ensurePlayitDir();
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "x64" ? "x86_64" : "aarch64";
  const downloadUrl = `https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-${platform}-${arch}.exe`;
  const binPath = getPlayitBin();

  try {
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) {
      const apiUrl = "https://api.github.com/repos/playit-cloud/playit-agent/releases/latest";
      const release = await fetch(apiUrl).then(r => r.json());
      const asset = release.assets?.find((a: any) => a.name === `playit-${platform}-${arch}.exe` || a.name === `playit-${platform}-${arch}`);
      if (asset) {
        const retry = await fetch(asset.browser_download_url, { redirect: "follow" });
        if (!retry.ok) throw new Error(`Retry also failed: HTTP ${retry.status}`);
        const buffer = Buffer.from(await retry.arrayBuffer());
        writeFileSync(binPath, buffer);
        return;
      }
      throw new Error(`Download failed: HTTP ${response.status}. Please download playit manually from https://playit.gg/download`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(binPath, buffer);
  } catch (err: any) {
    throw err;
  }
}

function startPlayit(serverId: string, port: number): Promise<{ success: boolean; claimUrl?: string; error?: string }> {
  return new Promise(async (resolve) => {
    const bin = getPlayitBin();

    if (!existsSync(bin)) {
      try {
        await downloadPlayit();
      } catch (err: any) {
        resolve({ success: false, error: `Failed to download playit: ${err.message}` });
        return;
      }
    }

    // Spawn detached with shell to get a visible console window.
    // stdio: "ignore" — output stays in playit's own window, not ours.
    const proc = spawn(bin, [], {
      detached: true,
      shell: true,
      stdio: "ignore",
    });

    proc.unref();
    playitProcesses.set(serverId, proc);
    resolve({ success: true });
  });
}

export function getPlayitAddress(serverId: string): string | null {
  return networkStates.get(serverId)?.address || null;
}

export function getNetworkState(serverId: string): NetworkState {
  if (!networkStates.has(serverId)) {
    networkStates.set(serverId, {
      enabled: false,
      mode: "none",
      address: null,
      playitClaimUrl: null,
      playitLinked: false,
      usePlayit: true,
      error: null,
    });
  }
  return networkStates.get(serverId)!;
}

function broadcastState(serverId: string, state: NetworkState): void {
  getIO()?.to(`server:${serverId}`).emit("network:state", state);
}

export function stopPlayit(serverId: string): void {
  const proc = playitProcesses.get(serverId);
  if (proc) {
    if (process.platform === "win32") {
      try { execSync(`taskkill /F /T /PID ${proc.pid} 2>nul`, { stdio: "ignore" }); } catch {}
    } else {
      try { proc.kill("SIGKILL"); } catch {}
    }
    playitProcesses.delete(serverId);
  }
}

export function forceKillAllPlayit(): void {
  for (const [id, proc] of playitProcesses) {
    if (process.platform === "win32") {
      try { execSync(`taskkill /F /T /PID ${proc.pid} 2>nul`, { stdio: "ignore" }); } catch {}
    } else {
      try { proc.kill("SIGKILL"); } catch {}
    }
  }
  playitProcesses.clear();
}

export async function getPlayitClaimUrl(): Promise<string | null> {
  if (!existsSync(getPlayitBin())) return null;
  return new Promise((resolve) => {
    const proc = spawn(getPlayitBin(), [], { stdio: "pipe" });
    let output = "";
    let resolved = false;
    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      if (!resolved) {
        const match = output.match(/https:\/\/playit\.gg\/claim\/\S+/);
        if (match) { resolved = true; resolve(match[0]); proc.kill(); }
      }
    });
    proc.on("exit", () => { if (!resolved) { resolved = true; resolve(null); } });
    setTimeout(() => { if (!resolved) { resolved = true; proc.kill(); resolve(null); } }, 15000);
  });
}

export async function enablePublicMode(serverId: string, port: number = 25565): Promise<NetworkState> {
  const state = getNetworkState(serverId);

  state.enabled = true;
  state.error = null;

  if (!state.usePlayit) {
    state.mode = "none";
    state.address = null;
    broadcastState(serverId, state);
    return state;
  }

  const playitResult = await startPlayit(serverId, port);

  if (playitResult.success) {
    state.mode = "playit";
    broadcastState(serverId, state);
    return state;
  }

  state.enabled = false;
  state.mode = "none";
  state.error = playitResult.error || "playit.gg failed to connect";
  broadcastState(serverId, state);
  return state;
}

export async function disablePublicMode(serverId: string): Promise<void> {
  const state = getNetworkState(serverId);
  state.enabled = false;

  if (state.mode === "playit") {
    stopPlayit(serverId);
  }

  state.mode = "none";
  state.address = null;
  state.error = null;
  broadcastState(serverId, state);
}

export async function refreshPlayitAddress(serverId: string): Promise<string | null> {
  const state = getNetworkState(serverId);
  if (state.mode !== "playit") return null;
  return state.address;
}

