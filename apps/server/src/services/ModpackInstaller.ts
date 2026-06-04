import path from "path";
import { existsSync, mkdirSync, rmSync, readFileSync, unlinkSync } from "fs";
import { getVersion, downloadModFile } from "./ModrinthClient.js";
import { downloadFabricJar, downloadVanillaJar } from "./ServerJarDownloader.js";
import { copyDirAsync } from "./FileUtils.js";
import { safeJoin, PathTraversalError } from "./safeJoin.js";

interface ModpackManifestFile {
  path: string;
  downloads: string[];
  fileSize: number;
  env?: {
    client?: string;
    server?: string;
  };
}

interface ModpackManifest {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  files: ModpackManifestFile[];
  dependencies: Record<string, string>;
}

export interface ModpackResult {
  name: string;
  gameVersion: string;
  loader: string;
  loaderVersion?: string;
  modResults: string[];
}

export type ProgressEmit = (msg: string, current: number, total: number) => void;

async function resolveLoaderVersion(gameVersion: string, rawVersion: string | undefined): Promise<string | undefined> {
  if (!rawVersion) return undefined;
  // Check if it contains range specifiers (>, <, =, ^, ~, *, comma)
  if (!/[><=^*~,]/.test(rawVersion) && /^\d/.test(rawVersion)) return rawVersion;

  try {
    const url = `https://meta.fabricmc.net/v2/versions/loader`;
    const response = await fetch(url);
    if (!response.ok) return rawVersion;
    const data = (await response.json()) as Array<{ loader: { version: string; stable: boolean } }>;

    const stable = data
      .filter((v) => v.loader.stable)
      .map((v) => v.loader.version)
      .sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      });

    if (stable.length > 0) return stable[0];
    return "0.16.10";
  } catch {}

  return rawVersion;
}

export async function installModpack(
  serverDir: string,
  versionId: string,
  emit?: ProgressEmit,
  preferredLoaderVersion?: string
): Promise<ModpackResult> {
  const version = await getVersion(versionId);
  const mrpackFile = version?.files?.find((f: any) => f.filename?.endsWith(".mrpack"));
  if (!mrpackFile) throw new Error("No .mrpack file found for this modpack version");

  const mrpackPath = path.join(serverDir, "pack.mrpack");
  emit?.("Downloading modpack file...", 0, 1);
  await downloadModFile(mrpackFile.url, mrpackPath);

  const extractDir = path.join(serverDir, ".pack-extract");
  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  emit?.("Extracting modpack...", 1, 1);
  const { default: extract } = await import("extract-zip");
  await extract(mrpackPath, { dir: extractDir });

  const manifestPath = path.join(extractDir, "modrinth.index.json");
  if (!existsSync(manifestPath)) throw new Error("modrinth.index.json not found");

  const manifestRaw = readFileSync(manifestPath, "utf-8");
  const manifest: ModpackManifest = JSON.parse(manifestRaw);

  const gameVersion = (version.game_versions?.[0] || manifest.dependencies?.minecraft || "").replace(/^v/, "");
  const loader = manifest.dependencies?.["fabric-loader"] ? "fabric" : "vanilla";
  const loaderVersion = preferredLoaderVersion
    || await resolveLoaderVersion(gameVersion, manifest.dependencies?.["fabric-loader"]);

  console.log(`Modpack: ${manifest.name}, MC ${gameVersion}, loader: ${loader} ${loaderVersion || ""}`);

  emit?.("Downloading server jar...", 1, 3);
  if (loader === "fabric" && loaderVersion) {
    await downloadFabricJar(serverDir, gameVersion, loaderVersion);
  } else {
    await downloadVanillaJar(serverDir, gameVersion);
  }

  const modsDir = path.join(serverDir, "mods");
  if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true });

  const files = manifest.files || [];
  console.log(`Downloading ${files.length} mods...`);
  const modResults: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    emit?.(`Downloading mods (${i + 1}/${files.length})...`, i + 1, files.length + 2);
    if (!file.downloads?.[0]) continue;

    if (file.env && file.env.server !== "required") {
      console.log(`  Skipped: ${file.path} (env server: ${file.env.server || "none"})`);
      continue;
    }

    // Skip client-only paths regardless of env (some modpack authors mislabel)
    const lowerPath = file.path.toLowerCase();
    if (
      lowerPath.startsWith("resourcepacks/") ||
      lowerPath.startsWith("shaderpacks/") ||
      lowerPath.startsWith("shaders/") ||
      lowerPath.startsWith("kubejs/assets/")
    ) {
      console.log(`  Skipped (client path): ${file.path}`);
      continue;
    }

    console.log(`  Installing: ${file.path} (env server: ${file.env?.server || "none"})`);

    let filePath: string;
    try {
      filePath = safeJoin(serverDir, file.path);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        console.warn(`Path traversal blocked for file: ${file.path}`);
        continue;
      }
      throw err;
    }

    const fileDir = path.dirname(filePath);
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
    try {
      await downloadModFile(file.downloads[0], filePath);
      modResults.push(file.path);
    } catch (e: any) {
      console.log(`  Failed: ${file.path} - ${e.message}`);
    }
  }

  const overridesDir = path.join(extractDir, "overrides");
  if (existsSync(overridesDir)) {
    await copyDirAsync(overridesDir, serverDir);
  }

  rmSync(extractDir, { recursive: true, force: true });
  try { unlinkSync(mrpackPath); } catch {}

  emit?.("Complete!", 1, 1);

  return { name: manifest.name, gameVersion, loader, loaderVersion, modResults };
}
