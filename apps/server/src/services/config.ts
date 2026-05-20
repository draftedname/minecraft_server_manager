import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..");

export const DATA_DIR = path.join(ROOT_DIR, "data");
export const SERVERS_DIR = path.join(DATA_DIR, "servers");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const SERVERS_FILE = path.join(DATA_DIR, "servers.json");
