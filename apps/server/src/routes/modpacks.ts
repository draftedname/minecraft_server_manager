import { Router, Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { loadServer, getServerDir, ensureServerDir, addServer, loadServers, saveServers } from "../services/DataStore.js";
import { getVersion, getProject, downloadModFile } from "../services/ModrinthClient.js";
import { downloadFabricJar, downloadVanillaJar } from "../services/ServerJarDownloader.js";
import { checkJava } from "../services/JavaManager.js";
import { copyDirAsync } from "../services/FileUtils.js";
import type { ServerConfig } from "@mcservergui/shared";
import { v4 as uuid } from "uuid";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

interface ModpackManifest {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  files: Array<{
    path: string;
    downloads: string[];
    fileSize: number;
    hashes: Record<string, string>;
  }>;
  dependencies: Record<string, string>;
}

router.post("/:serverId/install-modpack", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { versionId, modpackId } = req.body;
  if (!versionId) {
    res.status(400).json({ error: "versionId is required" });
    return;
  }

  const serverDir = getServerDir(serverId);

  try {
    // 1. Get the modpack version to find the .mrpack file
    const version = await getVersion(String(versionId));
    const mrpackFile = version?.files?.find((f: any) => f.filename?.endsWith(".mrpack"));
    if (!mrpackFile) throw new Error("No .mrpack file found for this version");

    // 2. Download .mrpack
    const mrpackPath = path.join(serverDir, "pack.mrpack");
    await downloadModFile(mrpackFile.url, mrpackPath);

    // 3. Extract (it's a zip)
    const extractDir = path.join(serverDir, ".pack-extract");
    if (existsSync(extractDir)) {
      const { rmSync } = await import("fs");
      rmSync(extractDir, { recursive: true, force: true });
    }
    mkdirSync(extractDir, { recursive: true });

    const { default: extract } = await import("extract-zip");
    await extract(mrpackPath, { dir: extractDir });

    // 4. Read manifest
    const manifestPath = path.join(extractDir, "modrinth.index.json");
    if (!existsSync(manifestPath)) throw new Error("modrinth.index.json not found in pack");
    const manifestRaw = (await import("fs")).readFileSync(manifestPath, "utf-8");
    const manifest: ModpackManifest = JSON.parse(manifestRaw);

    const gameVersion = (manifest.dependencies?.minecraft || manifest.versionId).replace(/^v/, "");
    const loader = manifest.dependencies?.["fabric-loader"] ? "fabric" : "vanilla";
    const loaderVersion = manifest.dependencies?.["fabric-loader"];

    // Update server config
    updateServer(serverId, {
      gameVersion,
      type: loader === "fabric" ? "fabric" : "vanilla",
      loaderVersion,
      modpackId: String(modpackId || ""),
      modpackVersionId: String(versionId),
    });

    // 5. Download server jar
    if (loader === "fabric" && loaderVersion) {
      await downloadFabricJar(serverId, gameVersion, loaderVersion);
    } else {
      await downloadVanillaJar(serverId, gameVersion);
    }

    // 6. Download all mods
    const modsDir = path.join(serverDir, "mods");
    if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true });

    const modResults: string[] = [];
    for (const file of manifest.files) {
      if (!file.downloads?.[0]) continue;
      const filePath = path.join(serverDir, file.path);
      const fileDir = path.dirname(filePath);
      if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
      try {
        await downloadModFile(file.downloads[0], filePath);
        modResults.push(file.path);
      } catch {
        console.log(`Failed to download mod: ${file.path}`);
      }
    }

    // 7. Copy overrides
    const overridesDir = path.join(extractDir, "overrides");
    if (existsSync(overridesDir)) {
      await copyDirAsync(overridesDir, serverDir);
    }

    // 8. Clean up
    const { rmSync } = await import("fs");
    rmSync(extractDir, { recursive: true, force: true });
    try { (await import("fs")).unlinkSync(mrpackPath); } catch {}

    res.json({
      success: true,
      gameVersion,
      loader,
      loaderVersion,
      modsInstalled: modResults.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function updateServer(id: string, updates: Partial<ServerConfig>): void {
  const servers = loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return;
  servers[idx] = { ...servers[idx], ...updates };
  saveServers(servers);
}

export { router as modpackRouter };
