import { ChildProcess, spawn, execSync } from "child_process";
import path from "path";
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { loadServer, loadServers, updateServer, getServerDir, ensureServerDir } from "./DataStore.js";
import type { ServerStatus, ServerInfo } from "@mcservergui/shared";
import { v4 as uuid } from "uuid";
import { getIO } from "../websocket/index.js";
import { getNetworkState, enablePublicMode } from "./NetworkManager.js";
import { findLocalJavaPath, checkJava, downloadJava } from "./JavaManager.js";

interface RunningServer {
  process: ChildProcess;
  config: {
    id: string;
    type: string;
    gameVersion: string;
    ram: number;
    javaPath: string;
  };
  startTime: number;
  status: ServerStatus;
  forceKillTimer: ReturnType<typeof setTimeout> | null;
}

const runningServers = new Map<string, RunningServer>();

// Track online players per server from console output
const onlinePlayers = new Map<string, Set<string>>();

function killProcess(proc: ChildProcess): void {
  if (process.platform === "win32") {
    try { execSync(`taskkill /F /T /PID ${proc.pid} 2>nul`, { stdio: "ignore" }); } catch {}
  } else {
    try { proc.kill("SIGKILL"); } catch {}
  }
}

export function getOnlinePlayers(serverId: string): string[] {
  return [...(onlinePlayers.get(serverId) || [])];
}

function trackPlayerActivity(serverId: string, line: string) {
  const joinMatch = line.match(/(\w+) joined the game$/);
  const leaveMatch = line.match(/(\w+) left the game$/);
  if (joinMatch) {
    const players = onlinePlayers.get(serverId) || new Set<string>();
    players.add(joinMatch[1]);
    onlinePlayers.set(serverId, players);
  }
  if (leaveMatch) {
    const players = onlinePlayers.get(serverId);
    if (players) {
      players.delete(leaveMatch[1]);
    }
  }
}

export function getRunningServer(id: string): RunningServer | undefined {
  return runningServers.get(id);
}

export function getAllRunning(): string[] {
  return Array.from(runningServers.keys());
}

export function getServerInfo(id: string): ServerInfo | null {
  const config = loadServer(id);
  if (!config) return null;

  const running = runningServers.get(id);
  return {
    config,
    status: running ? running.status : "stopped",
    pid: running ? (running.process.pid || null) : null,
    uptime: running ? Date.now() - running.startTime : 0,
  };
}

export function getAllServerInfos(): ServerInfo[] {
  const servers = loadServers();
  return servers.map((config) => getServerInfo(config.id)).filter((info): info is ServerInfo => info !== null);
}

function getJavaVersionForGame(gameVersion: string): string {
  const parts = gameVersion.split(".").map(Number);
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (parts[0] > 1 || minor > 20 || (minor === 20 && patch >= 5)) return "21";
  return "17";
}

export async function startServer(id: string): Promise<{ success: boolean; error?: string }> {
  const config = loadServer(id);
  if (!config) return { success: false, error: "Server not found" };
  if (runningServers.has(id) && runningServers.get(id)!.status !== "stopped") {
    return { success: false, error: "Server already running" };
  }

  const serverDir = ensureServerDir(id);

  const eulaPath = path.join(serverDir, "eula.txt");
  if (!existsSync(eulaPath) || !readFileSync(eulaPath, "utf-8").includes("eula=true")) {
    writeFileSync(eulaPath, "eula=true", "utf-8");
  }

  // Auto-download Java if not installed
  const javaInfo = checkJava();
  if (!javaInfo.installed) {
    const version = getJavaVersionForGame(config.gameVersion);
    const io = getIO();
    const emit = (msg: string, current: number, total: number) => {
      io?.emit("download:progress", { message: msg, current, total });
    };
    emit("Installing Java...", 0, 100);
    const result = await downloadJava(version, emit);
    if (!result.success || !result.path) {
      return {
        success: false,
        error: `Java JDK ${version} is required. Download it from https://adoptium.net`,
      };
    }
    config.javaPath = result.path;
    await updateServer(id, { javaPath: result.path });
  }

  const javaPath = config.javaPath || findLocalJavaPath() || "java";
  const ramMB = config.ram ?? 1024;

  // Auto-start network if public mode is on (fire and forget, don't emit progress)
  if (getNetworkState(id).enabled) {
    enablePublicMode(id, 25565).catch((err: Error) => {
      console.error(`[ServerManager] Failed to auto-start tunnel for ${id}: ${err.message}`);
    });
  }

  // For Fabric, use classpath approach from fabric-profile.json
  if (config.type === "fabric" || config.type === "modpack") {
    const profilePath = path.join(serverDir, "fabric-profile.json");
    if (existsSync(profilePath)) {
      const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
      const jarPath = path.join(serverDir, "server.jar");

      if (!existsSync(jarPath)) {
        return { success: false, error: "server.jar not found" };
      }

      const sep = process.platform === "win32" ? ";" : ":";
      const cp = Array.isArray(profile.classpath)
        ? profile.classpath.join(sep)
        : (process.platform === "win32"
            ? profile.classpath.replace(/\\\\/g, "\\")
            : profile.classpath.replace(/\\\\/g, ":"));

      const args = [
        `-Xmx${ramMB}M`,
        `-Xms${Math.floor(ramMB / 2)}M`,
        "-Dfabric.remapMods=true",
        "-cp",
        cp,
        profile.mainClass,
        "nogui",
      ];

      const proc = spawn(javaPath, args, {
        cwd: serverDir,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      return handleProcess(id, config, proc, serverDir);
    }

    // Fallback: try old fabric-server-launch.jar
    const launchJar = path.join(serverDir, "fabric-server-launch.jar");
    if (existsSync(launchJar)) {
      const proc = spawn(javaPath, [
        `-Xmx${ramMB}M`,
        `-Xms${Math.floor(ramMB / 2)}M`,
        "-Dfabric.remapMods=true",
        "-jar",
        "fabric-server-launch.jar",
        "nogui",
      ], {
        cwd: serverDir,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      return handleProcess(id, config, proc, serverDir);
    }

    return { success: false, error: "No Fabric setup found. Recreate the server." };
  }

  // Vanilla
  const jarPath = path.join(serverDir, "server.jar");
  if (!existsSync(jarPath)) {
    return { success: false, error: "Server jar not found. Recreate the server." };
  }

  const proc = spawn(javaPath, [
    `-Xmx${ramMB}M`,
    `-Xms${Math.floor(ramMB / 2)}M`,
    "-jar",
    "server.jar",
    "nogui",
  ], {
    cwd: serverDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return handleProcess(id, config, proc, serverDir);
}

function handleProcess(id: string, config: import("@mcservergui/shared").ServerConfig, proc: ChildProcess, serverDir: string): { success: boolean } {
  const running: RunningServer = {
    process: proc,
    config: {
      id: config.id,
      type: config.type,
      gameVersion: config.gameVersion,
      ram: config.ram,
      javaPath: config.javaPath,
    },
    startTime: Date.now(),
    status: "starting",
    forceKillTimer: null,
  };

  runningServers.set(id, running);

  const io = getIO();

  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      trackPlayerActivity(id, line);
      io?.to(`server:${id}`).emit("console:output", { line, timestamp: Date.now(), serverId: id });
    }

    // Detect server ready
    const text = data.toString();
    if (text.includes("Done") && text.includes("For help, type \"help\"")) {
      running.status = "running";
      io?.to(`server:${id}`).emit("server:status", { status: "running" });
      updateServer(id, { lastStartedAt: new Date().toISOString() }).catch(() => {});
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      io?.to(`server:${id}`).emit("console:output", {
        line: `[ERR] ${line}`,
        timestamp: Date.now(),
        serverId: id,
      });
    }
  });

  proc.on("exit", (code) => {
    if (running.forceKillTimer) {
      clearTimeout(running.forceKillTimer);
      running.forceKillTimer = null;
    }
    running.status = "stopped";
    io?.to(`server:${id}`).emit("server:status", {
      status: code === 0 ? "stopped" : "crashed",
      exitCode: code,
    });
    runningServers.delete(id);
    onlinePlayers.delete(id);
  });

  proc.on("error", (err) => {
    if (running.forceKillTimer) {
      clearTimeout(running.forceKillTimer);
      running.forceKillTimer = null;
    }
    running.status = "crashed";
    io?.to(`server:${id}`).emit("server:status", { status: "crashed", error: err.message });
    runningServers.delete(id);
    onlinePlayers.delete(id);
  });

  return { success: true };
}

export async function stopServer(id: string): Promise<{ success: boolean; error?: string }> {
  const running = runningServers.get(id);
  if (!running) return { success: false, error: "Server not running" };

  // Clear any stale force-kill timer from a previous stop
  if (running.forceKillTimer) {
    clearTimeout(running.forceKillTimer);
    running.forceKillTimer = null;
  }

  running.status = "stopping";
  getIO()?.to(`server:${id}`).emit("server:status", { status: "stopping" });

  running.process.stdin?.write("stop\n");

  running.forceKillTimer = setTimeout(() => {
    if (runningServers.has(id)) {
      killProcess(running.process);
      getIO()?.to(`server:${id}`).emit("server:status", { status: "crashed", exitCode: -1 });
      runningServers.delete(id);
      onlinePlayers.delete(id);
    }
  }, 30000);

  return { success: true };
}

export async function restartServer(id: string): Promise<{ success: boolean; error?: string }> {
  if (runningServers.has(id)) {
    const stopResult = await stopServer(id);
    if (!stopResult.success) return stopResult;

    // Wait for server to fully stop (poll for actual process exit)
    // Poll slightly longer than the force-kill timer (30s) to avoid race
    for (let i = 0; i < 70; i++) {
      if (!runningServers.has(id)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return startServer(id);
}

export function restartServerAsync(id: string): void {
  if (!runningServers.has(id)) {
    startServer(id).catch(() => {});
    return;
  }

  stopServer(id).then((stopResult) => {
    if (!stopResult.success) return;

    let attempts = 0;
    const poll = () => {
      if (!runningServers.has(id)) {
        startServer(id).catch(() => {});
        return;
      }
      if (++attempts < 70) {
        setTimeout(poll, 500);
      }
    };
    poll();
  });
}

export function sendCommand(id: string, command: string): { success: boolean; error?: string } {
  const running = runningServers.get(id);
  if (!running) return { success: false, error: "Server not running" };

  running.process.stdin?.write(`${command}\n`);
  return { success: true };
}

export function forceKillAll(): void {
  for (const [id, running] of runningServers) {
    if (running.forceKillTimer) {
      clearTimeout(running.forceKillTimer);
    }
    try { killProcess(running.process); } catch {}
  }
  runningServers.clear();
  onlinePlayers.clear();
}
