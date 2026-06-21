import { httpServer } from "./index.js";
import path from "path";
import { startScheduler, stopScheduler } from "./services/BackupScheduler.js";
import { forceKillAll, getAllRunning } from "./services/ServerManager.js";
import { forceKillAllPlayit } from "./services/NetworkManager.js";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

async function startBackend(): Promise<number> {
  return new Promise((resolve) => {
    const envPort = process.env.MCSERVERGUI_WEB_PORT ? parseInt(process.env.MCSERVERGUI_WEB_PORT, 10) : 8080;
    httpServer.listen(envPort, "127.0.0.1", () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 3456;
      console.log(`MC Server GUI backend running on http://localhost:${port}`);
      startScheduler();
      resolve(port);
    });
  });
}

async function main(): Promise<void> {
  const { app } = await import("electron");
  if (!process.env.MCSERVERGUI_DATA_DIR) {
    process.env.MCSERVERGUI_DATA_DIR = path.join(app.getPath("userData"), "data");
  }

  const port = await startBackend();
  process.env.MCSERVERGUI_PORT = String(port);

  const { BrowserWindow, shell, Tray, Menu, nativeImage, dialog } = await import("electron");

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

  // Auto-update via GitHub releases
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "draftedname",
    repo: "minecraft_server_manager",
  });

  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  // Show dialog when update is available
  autoUpdater.on("update-available", () => {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Update Available",
      message: "A new version is available. Downloading now...",
    });
  });
  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Update Ready",
      message: "Update downloaded. Install and restart now?",
      buttons: ["Later", "Install"],
      defaultId: 1,
    }).then(({ response }) => {
      if (response === 1) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Open external URLs (OAuth) in system browser, not Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  let closing = false;
  let tray: InstanceType<typeof Tray> | null = null;

  // 16x16 blue icon for system tray
  const trayIcon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2N4z8BQz0BJYKACMDIwMDJQSRdoNAONHIeG0oBoEwwNpQHRJhgaSgMAmRIE+EH/Mm4AAAAASUVORK5CYII="
  );

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Show", click: () => win.show() },
    { type: "separator" },
    { label: "Quit", click: async () => {
      const running = getAllRunning();
      if (running.length > 0) {
        const { response } = await dialog.showMessageBox(win, {
          type: "warning",
          title: "Servers Running",
          message: `${running.length} server(s) are still running.`,
          detail: "Quitting now will force-kill all servers and may cause world corruption. Are you sure?",
          buttons: ["Cancel", "Quit Anyway"],
          defaultId: 0,
          cancelId: 0,
        });
        if (response === 0) return;
      }
      closing = true;
      if (tray) tray.destroy();
      forceKillAll();
      forceKillAllPlayit();
      stopScheduler();
      httpServer.close();
      app.quit();
    }}
  ]);
  tray.setToolTip("MC Server GUI");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => win.show());

  win.on("close", async (e: { preventDefault: () => void }) => {
    if (closing) return;
    e.preventDefault();
    const running = getAllRunning();
    if (running.length > 0) {
      const { response } = await dialog.showMessageBox(win, {
        type: "question",
        title: "Close App",
        message: `${running.length} server(s) are running.`,
        detail: "Minimize to system tray to keep servers running, or quit to stop everything.",
        buttons: ["Cancel", "Quit", "Minimize to Tray"],
        defaultId: 2,
        cancelId: 0,
      });
      if (response === 1) {
        // Quit
        closing = true;
        if (tray) tray.destroy();
        forceKillAll();
        forceKillAllPlayit();
        stopScheduler();
        httpServer.close();
        app.quit();
      } else if (response === 2) {
        // Minimize to tray
        win.hide();
      }
      // response === 0: cancel, do nothing
    } else {
      // No servers running, just quit
      closing = true;
      if (tray) tray.destroy();
      stopScheduler();
      httpServer.close();
      app.quit();
    }
  });
}

main().catch((err) => {
  console.error("Failed to start Electron app:", err);
  process.exit(1);
});
