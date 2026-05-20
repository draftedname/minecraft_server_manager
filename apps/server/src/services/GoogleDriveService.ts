import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, unlinkSync } from "fs";
import path from "path";
import { google } from "googleapis";
import { DATA_DIR } from "./config.js";

const CREDENTIALS_DIR = path.join(DATA_DIR, "credentials");
const TOKEN_PATH = path.join(CREDENTIALS_DIR, "drive-token.json");
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, "google-credentials.json");

// App folder name in Google Drive
const APP_FOLDER_NAME = "MC Server GUI Backups";

function ensureDirs() {
  if (!existsSync(CREDENTIALS_DIR)) mkdirSync(CREDENTIALS_DIR, { recursive: true });
}

function getOAuth2Client() {
  ensureDirs();

  if (!existsSync(CREDENTIALS_PATH)) {
    return null;
  }

  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed || credentials.web || credentials;

  const redirectUri = credentials.installed
    ? "http://localhost:3456/api/drive/oauth2callback"
    : "http://localhost:3456/api/drive/oauth2callback";

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  if (existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
      oauth2Client.setCredentials(token);
    } catch {
      // Token invalid
    }
  }

  return oauth2Client;
}

export function getDriveStatus(): {
  hasCredentials: boolean;
  authenticated: boolean;
  folderId: string | null;
} {
  const oauth = getOAuth2Client();
  const hasCredentials = oauth !== null;
  let authenticated = false;
  if (oauth && existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
      authenticated = !!token.refresh_token || !!token.access_token;
    } catch {}
  }

  // Read stored folder ID
  let folderId: string | null = null;
  const configPath = path.join(CREDENTIALS_DIR, "drive-config.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      folderId = config.folderId || null;
    } catch {}
  }

  return { hasCredentials, authenticated, folderId };
}

export function getAuthUrl(): string | null {
  const oauth = getOAuth2Client();
  if (!oauth) return null;

  return oauth.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive"],
    prompt: "consent",
  });
}

export async function handleOAuthCallback(code: string): Promise<boolean> {
  const oauth = getOAuth2Client();
  if (!oauth) return false;

  try {
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);
    ensureDirs();
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

async function getDriveClient() {
  const oauth = getOAuth2Client();
  if (!oauth) throw new Error("OAuth credentials not configured");

  if (!existsSync(TOKEN_PATH)) throw new Error("Not authenticated");

  const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
  oauth.setCredentials(token);

  // Refresh token if expired
  if (token.expiry_date && Date.now() > token.expiry_date) {
    try {
      const { credentials } = await oauth.refreshAccessToken();
      writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2), "utf-8");
      oauth.setCredentials(credentials);
    } catch {
      throw new Error("Failed to refresh token. Re-authenticate.");
    }
  }

  return google.drive({ version: "v3", auth: oauth });
}

async function getOrCreateFolder(drive: any): Promise<string> {
  const configPath = path.join(CREDENTIALS_DIR, "drive-config.json");

  // Check cached folder ID
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.folderId) {
        // Verify folder still exists
        try {
          await drive.files.get({ fileId: config.folderId });
          return config.folderId;
        } catch {
          // Folder deleted, recreate
        }
      }
    } catch {}
  }

  // Search for existing folder
  const res = await drive.files.list({
    q: `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
  });

  if (res.data.files.length > 0) {
    const folderId = res.data.files[0].id;
    writeFileSync(configPath, JSON.stringify({ folderId }, null, 2), "utf-8");
    return folderId;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: APP_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  writeFileSync(configPath, JSON.stringify({ folderId: folder.data.id }, null, 2), "utf-8");
  return folder.data.id;
}

export async function uploadBackupToDrive(
  serverName: string,
  zipPath: string,
  filename: string
): Promise<{ success: boolean; fileId?: string; error?: string }> {
  try {
    const drive = await getDriveClient();
    const folderId = await getOrCreateFolder(drive);

    const response = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
        description: `Backup of ${serverName}`,
      },
      media: {
        body: createReadStream(zipPath),
      },
      fields: "id, name, size",
    });

    return { success: true, fileId: response.data.id! };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function listDriveBackups(): Promise<
  Array<{ id: string; name: string; size: string; created: string }>
> {
  try {
    const drive = await getDriveClient();
    const folderId = await getOrCreateFolder(drive);

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id, name, size, createdTime)",
      orderBy: "createdTime desc",
    });

    return (res.data.files || []).map((f: any) => ({
      id: f.id || "",
      name: f.name || "",
      size: f.size || "0",
      created: f.createdTime || "",
    }));
  } catch {
    return [];
  }
}

export async function downloadDriveBackup(fileId: string, destPath: string): Promise<boolean> {
  try {
    const drive = await getDriveClient();
    const dest = (await import("fs")).createWriteStream(destPath);

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    await new Promise<void>((resolve, reject) => {
      res.data
        .pipe(dest)
        .on("finish", resolve)
        .on("error", reject);
    });

    return true;
  } catch {
    return false;
  }
}

export async function deleteDriveBackup(fileId: string): Promise<boolean> {
  try {
    const drive = await getDriveClient();
    await drive.files.delete({ fileId });
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDrive(): Promise<void> {
  if (existsSync(TOKEN_PATH)) unlinkSync(TOKEN_PATH);
  const configPath = path.join(CREDENTIALS_DIR, "drive-config.json");
  if (existsSync(configPath)) unlinkSync(configPath);
}

export { CREDENTIALS_PATH };
