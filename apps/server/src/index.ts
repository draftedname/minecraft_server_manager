import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DATA_DIR, SERVERS_DIR, SERVERS_FILE, BACKUPS_DIR } from "./services/config.js";
import { loadServers, saveServers } from "./services/DataStore.js";
import { serversRouter } from "./routes/servers.js";
import { versionsRouter } from "./routes/versions.js";
import { javaRouter } from "./routes/java.js";
import { modrinthRouter } from "./routes/modrinth.js";
import { modsRouter } from "./routes/mods.js";
import { worldsRouter } from "./routes/worlds.js";
import { playersRouter } from "./routes/players.js";
import { settingsRouter } from "./routes/settings.js";
import { filesRouter } from "./routes/files.js";
import { modpackRouter } from "./routes/modpacks.js";
import { driveRouter } from "./routes/drive.js";
import { networkRouter } from "./routes/network.js";
import { uploadRouter, uploadChunkRouter } from "./routes/upload.js";
import { setupWebSocket } from "./websocket/index.js";
import { startScheduler, stopScheduler } from "./services/BackupScheduler.js";
import { getAllRunning, stopServer, forceKillAll } from "./services/ServerManager.js";

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(SERVERS_DIR)) mkdirSync(SERVERS_DIR, { recursive: true });
if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
if (!existsSync(SERVERS_FILE)) writeFileSync(SERVERS_FILE, "[]", "utf-8");

// Clean up stale server entries (directories deleted manually)
{
  const servers = loadServers();
  const valid = servers.filter((s) => existsSync(path.join(SERVERS_DIR, s.id)));
  if (valid.length !== servers.length) {
    saveServers(valid);
  }
}

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: /^https?:\/\/localhost(:\d+)?$/,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: /^https?:\/\/localhost(:\d+)?$/ }));

// Mount chunk upload router before express.json to avoid buffering chunks in memory
app.use("/api", uploadChunkRouter);

app.use(express.json());

app.use("/api/versions", versionsRouter);
app.use("/api/java", javaRouter);
app.use("/api/modrinth", modrinthRouter);
app.use("/api/servers", modsRouter);
app.use("/api/servers", worldsRouter);
app.use("/api/servers", playersRouter);
app.use("/api/servers", settingsRouter);
app.use("/api/servers", filesRouter);
app.use("/api/servers", modpackRouter);
app.use("/api", driveRouter);
app.use("/api/servers", networkRouter);
app.use("/api/servers", serversRouter); // Must be last: its GET /:id would shadow sub-routers
app.use("/api", uploadRouter);

// Serve pre-built frontend if client dist exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));

  // SPA catch-all: all non-API, non-socket.io GET requests serve index.html
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

setupWebSocket(io);

// Module guard: only auto-listen when this file is the entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const PORT = parseInt(process.env.MCSERVERGUI_WEB_PORT || "3456", 10);
  httpServer.listen(PORT, () => {
    console.log(`MC Server GUI backend running on http://localhost:${PORT}`);
    startScheduler();
  });
}

// Graceful shutdown
const shutdown = () => {
  forceKillAll();
  stopScheduler();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { app, httpServer, io, shutdown };
