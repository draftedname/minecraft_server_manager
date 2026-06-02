import path from "path";
import os from "os";

function getAppDataDir(): string {
  if (process.env.MCSERVERGUI_DATA_DIR) {
    return path.resolve(process.env.MCSERVERGUI_DATA_DIR);
  }

  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "mcservergui-data");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "mcservergui-data");
  }
  // Linux and others: XDG data home
  const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdgData, "mcservergui-data");
}

const ROOT_DIR = getAppDataDir();

export const DATA_DIR = ROOT_DIR;
export const SERVERS_DIR = path.join(DATA_DIR, "servers");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const SERVERS_FILE = path.join(DATA_DIR, "servers.json");
