import { spawnSync } from "child_process";
import { getIO } from "../websocket/index.js";

interface NetworkState {
  enabled: boolean;
  mode: "playit" | "none";
  address: string | null;
  playitClaimUrl: string | null;
  playitLinked: boolean;
  error: string | null;
}

const networkStates = new Map<string, NetworkState>();

function isWindows(): boolean {
  return process.platform === "win32";
}

function scQuery(): { exists: boolean; running: boolean; error?: string } {
  try {
    const result = spawnSync("sc", ["query", "playitd"], { encoding: "utf-8", stdio: "pipe", windowsHide: true });
    if (result.error) {
      return { exists: false, running: false, error: `sc command failed: ${result.error.message}` };
    }
    return { exists: true, running: result.stdout?.includes("RUNNING") ?? false };
  } catch (err: any) {
    return { exists: false, running: false, error: `sc command not available: ${err.message}` };
  }
}

function scStart(): { success: boolean; error?: string } {
  try {
    const result = spawnSync("sc", ["start", "playitd"], { encoding: "utf-8", stdio: "pipe", windowsHide: true });
    if (result.status !== 0 && !(result.stderr?.includes("already been started") || result.stderr?.includes("1056"))) {
      return { success: false, error: (result.stderr || "").trim() || "Failed to start playitd service" };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to start playitd service" };
  }
}

function scStop(): { success: boolean; error?: string } {
  try {
    const result = spawnSync("sc", ["stop", "playitd"], { encoding: "utf-8", stdio: "pipe", windowsHide: true });
    if (result.status !== 0 && !(result.stderr?.includes("not started") || result.stderr?.includes("1062"))) {
      return { success: false, error: (result.stderr || "").trim() || "Failed to stop playitd service" };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to stop playitd service" };
  }
}

export function getNetworkState(serverId: string): NetworkState {
  if (!networkStates.has(serverId)) {
    networkStates.set(serverId, {
      enabled: false,
      mode: "none",
      address: null,
      playitClaimUrl: null,
      playitLinked: false,
      error: null,
    });
  }
  return networkStates.get(serverId)!;
}

function broadcastState(serverId: string, state: NetworkState): void {
  getIO()?.to(`server:${serverId}`).emit("network:state", state);
}

export async function enablePublicMode(serverId: string, port: number = 25565): Promise<NetworkState> {
  const state = getNetworkState(serverId);

  if (!isWindows()) {
    state.enabled = false;
    state.error = "playit.gg service management is only available on Windows.";
    broadcastState(serverId, state);
    return state;
  }

  const { exists } = scQuery();
  if (!exists) {
    state.enabled = false;
    state.error = "playitd service not found. Install playit.gg first.";
    broadcastState(serverId, state);
    return state;
  }

  state.enabled = true;
  state.error = null;

  const result = scStart();
  if (result.success) {
    state.mode = "playit";
    broadcastState(serverId, state);
    return state;
  }

  state.enabled = false;
  state.mode = "none";
  state.error = result.error || "Failed to start playitd service";
  broadcastState(serverId, state);
  return state;
}

export async function disablePublicMode(serverId: string): Promise<void> {
  const state = getNetworkState(serverId);
  state.enabled = false;

  scStop();

  state.mode = "none";
  state.address = null;
  state.error = null;
  broadcastState(serverId, state);
}

export function forceKillAllPlayit(): void {
  try {
    spawnSync("sc", ["stop", "playitd"], { encoding: "utf-8", stdio: "pipe", windowsHide: true });
  } catch {}
}
