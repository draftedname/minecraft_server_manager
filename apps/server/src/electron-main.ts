import { httpServer } from "./index.js";
import { startScheduler, stopScheduler } from "./services/BackupScheduler.js";
import { forceKillAll } from "./services/ServerManager.js";
import { forceKillAllPlayit } from "./services/NetworkManager.js";

async function startBackend(): Promise<number> {
  return new Promise((resolve) => {
    const envPort = process.env.MCSERVERGUI_WEB_PORT ? parseInt(process.env.MCSERVERGUI_WEB_PORT, 10) : 8080;
    httpServer.listen(envPort, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 3456;
      console.log(`MC Server GUI backend running on http://localhost:${port}`);
      startScheduler();
      resolve(port);
    });
  });
}

async function main(): Promise<void> {
  const port = await startBackend();
  process.env.MCSERVERGUI_PORT = String(port);

  const { app, BrowserWindow, shell } = await import("electron");

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${port}`);
  win.setMenuBarVisibility(false);

  // Open external URLs (OAuth) in system browser, not Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Cascade cleanup on window close: stop MC servers, tunnels, scheduler, then exit
  let closing = false;
  win.on("close", (e: { preventDefault: () => void }) => {
    if (!closing) {
      e.preventDefault();
      closing = true;
      console.log("Shutting down... Cascade cleanup started.");
      forceKillAll();
      forceKillAllPlayit();
      stopScheduler();
      httpServer.close();
      win.destroy();
      app.quit();
    }
  });
}

main().catch((err) => {
  console.error("Failed to start Electron app:", err);
  process.exit(1);
});
