import { Router, Request, Response } from "express";
import path from "path";
import { readdirSync, statSync, existsSync, renameSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { loadServer, getServerDir } from "../services/DataStore.js";
import {
  getVersion,
  downloadModFile,
  getLatestCompatibleVersion,
  getProject,
} from "../services/ModrinthClient.js";
import { getIO } from "../websocket/index.js";
import type { ModInfo } from "@mcservergui/shared";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

router.get("/:serverId/mods", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const modsDir = path.join(getServerDir(serverId), "mods");

  if (!existsSync(modsDir)) {
    res.json([]);
    return;
  }

  const files = readdirSync(modsDir);
  const mods: ModInfo[] = files
    .filter((f) => f.endsWith(".jar") || f.endsWith(".jar.disabled"))
    .map((f) => {
      const filePath = path.join(modsDir, f);
      const stat = statSync(filePath);
      return {
        filename: f,
        size: stat.size,
        enabled: f.endsWith(".jar"),
        modrinthId: null,
        name: f.replace(/\.jar(\.disabled)?$/, ""),
        version: null,
      };
    });

  res.json(mods);
});

router.post("/:serverId/mods/install", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { versionId, projectId } = req.body;
  if (!versionId) {
    res.status(400).json({ error: "versionId is required" });
    return;
  }

  const modsDir = path.join(getServerDir(serverId), "mods");

  try {
    const io = getIO();
    io?.emit("download:progress", { message: "Fetching mod version...", current: 1, total: 4 });

    const version = await getVersion(versionId);
    const file = version?.files?.[0];
    if (!file?.url) {
      res.status(400).json({ error: "No downloadable file for this version" });
      return;
    }

    io?.emit("download:progress", { message: `Downloading ${file.filename}...`, current: 2, total: 4 });

    const dest = path.join(modsDir, file.filename);
    await downloadModFile(file.url, dest);
    io?.emit("download:progress", { message: `Downloading ${file.filename}...`, current: 3, total: 4 });

    // Save metadata for updates
    if (projectId || version) {
      saveModMeta(serverId, file.filename, {
        projectId: projectId || "",
        versionId,
        versionNumber: version?.version_number || "",
        installedAt: new Date().toISOString(),
        gameVersions: version?.game_versions || [],
      });
    }

    io?.emit("download:progress", { message: "Complete!", current: 4, total: 4 });

    res.json({ installed: file.filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:serverId/mods/upload", async (req: Request, res: Response) => {
  res.status(501).json({ error: "File upload not yet implemented" });
});

router.delete("/:serverId/mods/:filename", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const modPath = path.join(
    getServerDir(serverId),
    "mods",
    p(req.params, "filename")
  );

  if (!existsSync(modPath)) {
    res.status(404).json({ error: "Mod not found" });
    return;
  }

  unlinkSync(modPath);
  res.json({ success: true });
});

router.put("/:serverId/mods/:filename/toggle", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const filename = p(req.params, "filename");
  const modsDir = path.join(getServerDir(serverId), "mods");
  const currentPath = path.join(modsDir, filename);

  if (!existsSync(currentPath)) {
    res.status(404).json({ error: "Mod not found" });
    return;
  }

  let newFilename: string;
  if (filename.endsWith(".jar.disabled")) {
    newFilename = filename.replace(".disabled", "");
  } else if (filename.endsWith(".jar")) {
    newFilename = filename + ".disabled";
  } else {
    res.status(400).json({ error: "Invalid mod filename" });
    return;
  }

  const newPath = path.join(modsDir, newFilename);
  renameSync(currentPath, newPath);
  res.json({ success: true, enabled: !filename.endsWith(".disabled") });
});

// Mod metadata for update checking
interface ModMeta {
  projectId: string;
  versionId: string;
  versionNumber: string;
  installedAt: string;
  gameVersions: string[];
}

function getMetaPath(serverId: string): string {
  return path.join(getServerDir(serverId), "mods", "mods-metadata.json");
}

function loadModMeta(serverId: string): Record<string, ModMeta> {
  const metaPath = getMetaPath(serverId);
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveModMeta(serverId: string, filename: string, meta: ModMeta): void {
  const metaPath = getMetaPath(serverId);
  const all = loadModMeta(serverId);
  all[filename] = meta;
  writeFileSync(metaPath, JSON.stringify(all, null, 2), "utf-8");
}

router.post("/:serverId/mods/check-updates", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const meta = loadModMeta(serverId);
  const entries = Object.entries(meta);

  if (entries.length === 0) {
    res.json({ updates: [], message: "No mod metadata found. Only mods installed through this app can be checked." });
    return;
  }

  const loader = server.type === "fabric" ? "fabric" : undefined;
  const gameVersion = server.gameVersion;

  const updates: Array<{
    filename: string;
    currentVersion: string;
    latestVersion: string | null;
    latestVersionId: string | null;
    projectId: string;
  }> = [];

  for (const [filename, modMeta] of entries) {
    if (!modMeta.projectId) continue;

    try {
      const latest = await getLatestCompatibleVersion(modMeta.projectId, gameVersion, loader);
      if (latest && latest.version_number !== modMeta.versionNumber) {
        updates.push({
          filename,
          currentVersion: modMeta.versionNumber,
          latestVersion: latest.version_number,
          latestVersionId: latest.id,
          projectId: modMeta.projectId,
        });
      }
    } catch {
      // skip mods that can't be checked
    }
  }

  res.json({ updates, total: entries.length, outdated: updates.length });
});

router.post("/:serverId/mods/update-all", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const meta = loadModMeta(serverId);
  const modsDir = path.join(getServerDir(serverId), "mods");
  const loader = server.type === "fabric" ? "fabric" : undefined;
  const gameVersion = server.gameVersion;

  const results: Array<{ filename: string; success: boolean; error?: string }> = [];
  const io = getIO();

  for (const [filename, modMeta] of Object.entries(meta)) {
    if (!modMeta.projectId) continue;

    try {
      const latest = await getLatestCompatibleVersion(modMeta.projectId, gameVersion, loader);
      if (!latest || latest.version_number === modMeta.versionNumber) continue;

      const file = latest.files?.[0];
      if (!file?.url) continue;

      // Remove old mod file
      const oldPath = path.join(modsDir, filename);
      if (existsSync(oldPath)) unlinkSync(oldPath);

      // Download new version
      const dest = path.join(modsDir, file.filename);
    await downloadModFile(file.url, dest);
    io?.emit("download:progress", { message: "Complete!", current: 1, total: 1 });

      // Update metadata
      saveModMeta(serverId, file.filename, {
        projectId: modMeta.projectId,
        versionId: latest.id,
        versionNumber: latest.version_number,
        installedAt: new Date().toISOString(),
        gameVersions: latest.game_versions || [],
      });

      // Remove old metadata entry if filename changed
      if (file.filename !== filename) {
        const allMeta = loadModMeta(serverId);
        delete allMeta[filename];
        const metaPath = getMetaPath(serverId);
        writeFileSync(metaPath, JSON.stringify(allMeta, null, 2), "utf-8");
      }

      results.push({ filename: file.filename, success: true });
    } catch (err: any) {
      results.push({ filename, success: false, error: err.message });
    }
  }

  res.json({ results, updated: results.filter((r) => r.success).length });
});

export { router as modsRouter };
