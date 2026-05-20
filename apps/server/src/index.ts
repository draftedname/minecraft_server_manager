import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { DATA_DIR, SERVERS_DIR, SERVERS_FILE, BACKUPS_DIR } from "./services/config.js";
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
import { uploadRouter } from "./routes/upload.js";
import { setupWebSocket } from "./websocket/index.js";
import { startScheduler, stopScheduler } from "./services/BackupScheduler.js";
import { getAllRunning, stopServer, forceKillAll } from "./services/ServerManager.js";
import { forceKillAllPlayit } from "./services/NetworkManager.js";

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(SERVERS_DIR)) mkdirSync(SERVERS_DIR, { recursive: true });
if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
if (!existsSync(SERVERS_FILE)) writeFileSync(SERVERS_FILE, "[]", "utf-8");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

app.use("/api/servers", serversRouter);
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
app.use("/api", uploadRouter);

setupWebSocket(io);

const PORT = 3456;
httpServer.listen(PORT, () => {
  console.log(`MC Server GUI backend running on http://localhost:${PORT}`);
  console.log("(Press Ctrl+C to stop. If playit is running, press Y when prompted.)");
  startScheduler();
});

// Graceful shutdown — kill all child processes on Ctrl+C
process.on("SIGINT", () => {
  forceKillAll();
  stopScheduler();
  process.exit(0);
});
