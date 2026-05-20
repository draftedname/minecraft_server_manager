import { ChildProcess, spawn } from "child_process";
import path from "path";
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { loadServer, loadServers, updateServer, getServerDir, ensureServerDir } from "./DataStore.js";
import type { ServerStatus, ServerInfo } from "@mcservergui/shared";
import { v4 as uuid } from "uuid";
import { getIO } from "../websocket/index.js";
import { getNetworkState, enablePublicMode } from "./NetworkManager.js";

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
}

const runningServers = new Map<string, RunningServer>();

// Track online players per server from console output
const onlinePlayers = new Map<string, Set<string>>();

export function getOnlinePlayers(serverId: string): string[] {
  return [...(onlinePlayers.get(serverId) || [])];
}

function trackPlayerActivity(serverId: string, line: string) {
  const joinMatch = line.match(/(\w+) joined the game/);
  const leaveMatch = line.match(/(\w+) left the game/);
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

  const javaPath = config.javaPath || "java";
  const ramMB = config.ram || 1024;

  // Auto-start network if public mode is on (fire and forget, don't emit progress)
  if (getNetworkState(id).enabled) {
    enablePublicMode(id, 25565).catch(() => {});
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

      const cp = process.platform === "win32"
        ? profile.classpath.replace(/\\\\/g, "\\")
        : profile.classpath.replace(/\\\\/g, ":");

      const args = [
        `-Xmx${ramMB}M`,
        `-Xms${Math.floor(ramMB / 2)}M`,
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
  };

  runningServers.set(id, running);

  const io = getIO();
  const logPath = path.join(serverDir, "logs", "latest.log");

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
      updateServer(id, { lastStartedAt: new Date().toISOString() });
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
    running.status = "stopped";
    io?.to(`server:${id}`).emit("server:status", {
      status: code === 0 ? "stopped" : "crashed",
      exitCode: code,
    });
    runningServers.delete(id);
  });

  proc.on("error", (err) => {
    running.status = "crashed";
    io?.to(`server:${id}`).emit("server:status", { status: "crashed", error: err.message });
    runningServers.delete(id);
  });

  return { success: true };
}

export async function stopServer(id: string): Promise<{ success: boolean; error?: string }> {
  const running = runningServers.get(id);
  if (!running) return { success: false, error: "Server not running" };

  running.status = "stopping";
  getIO()?.to(`server:${id}`).emit("server:status", { status: "stopping" });

  running.process.stdin?.write("stop\n");

  // Force kill after 30 seconds if not stopped
  setTimeout(() => {
    if (runningServers.has(id)) {
      running.process.kill("SIGKILL");
      runningServers.delete(id);
    }
  }, 30000);

  return { success: true };
}

export async function restartServer(id: string): Promise<{ success: boolean; error?: string }> {
  if (runningServers.has(id)) {
    const stopResult = await stopServer(id);
    if (!stopResult.success) return stopResult;

    // Wait for server to fully stop
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return startServer(id);
}

export function sendCommand(id: string, command: string): { success: boolean; error?: string } {
  const running = runningServers.get(id);
  if (!running) return { success: false, error: "Server not running" };

  running.process.stdin?.write(`${command}\n`);
  return { success: true };
}

export function forceKillAll(): void {
  for (const [id, running] of runningServers) {
    try { running.process.kill("SIGKILL"); } catch {}
  }
  runningServers.clear();
}
