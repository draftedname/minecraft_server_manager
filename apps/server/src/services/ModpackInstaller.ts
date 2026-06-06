import path from "path";
import { existsSync, mkdirSync, rmSync, readFileSync, unlinkSync } from "fs";
import { getVersion, getProject, downloadModFile } from "./ModrinthClient.js";
import { CLIENT_ONLY_PROJECTS, checkFabricJarEnvironment } from "./ModFilter.js";
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

function extractProjectIdFromUrl(url: string): string | null {
  const match = url.match(/\/data\/([a-zA-Z0-9_-]+)\/versions\//);
  return match ? match[1] : null;
}

function matchesBlacklist(filePath: string): boolean {
  const basename = path.basename(filePath, ".jar").toLowerCase();
  if (!basename) return false;
  // Split on common separators and check every prefix chain against blacklist
  // e.g. "sodium-fabric-0.5.11" -> check "sodium", "sodium-fabric", "sodium-fabric-0...
  const tokens = basename.split(/[-_]+/);
  for (let i = 1; i <= tokens.length; i++) {
    const candidate = tokens.slice(0, i).join("-");
    if (CLIENT_ONLY_PROJECTS.has(candidate)) return true;
  }
  return false;
}

export async function installModpack(
  serverDir: string,
  versionId: string,
  emit?: ProgressEmit,
  preferredLoaderVersion?: string,
  includeFiles?: Set<string>
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
  const serverSideCache = new Map<string, string>();

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
      lowerPath.includes("/resourcepacks/") ||
      lowerPath.startsWith("shaderpacks/") ||
      lowerPath.includes("/shaderpacks/") ||
      lowerPath.startsWith("shaders/") ||
      lowerPath.includes("/shaders/") ||
      lowerPath.startsWith("kubejs/assets/") ||
      lowerPath.includes("/kubejs/assets/")
    ) {
      console.log(`  Skipped (client path): ${file.path}`);
      continue;
    }

    // Client-side preview filter
    if (includeFiles && !includeFiles.has(file.path)) {
      console.log(`  Skipped (preview filter): ${file.path}`);
      continue;
    }

    console.log(`  Installing: ${file.path} (env server: ${file.env?.server || "none"})`);

    const projectId = extractProjectIdFromUrl(file.downloads[0]);

    // Layer 1 (API): authoritative Modrinth server_side check (only if project ID is known)
    if (projectId) {
      try {
        if (!serverSideCache.has(projectId)) {
          const project = await getProject(projectId);
          serverSideCache.set(projectId, project.server_side);
        }
        if (serverSideCache.get(projectId) === "unsupported") {
          console.log(`  Filtered (API): ${file.path} - server_side: unsupported`);
          continue;
        }
      } catch (e: any) {
        console.warn(`  Warning: API check failed for project ${projectId}: ${e.message}`);
      }
    }

    // Layer 2 (blacklist): fallback for mods that passed API check or have no project ID
    if ((projectId && CLIENT_ONLY_PROJECTS.has(projectId)) || matchesBlacklist(file.path)) {
      console.log(`  Filtered (blacklist): ${file.path}`);
      continue;
    }

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

      // Layer 3: JAR inspection
      // NOTE: Only checks fabric.mod.json (Fabric/Quilt mods). Forge/NeoForge
      // mods (META-INF/mods.toml) pass through unchecked. The blacklist
      // partially mitigates this for known client-only Forge mods.
      if (filePath.endsWith(".jar")) {
        try {
          const env = await checkFabricJarEnvironment(filePath);
          if (env === "client") {
            unlinkSync(filePath);
            console.log(`  Filtered (JAR): ${file.path} - fabric environment: client`);
            continue;
          }
        } catch (e: any) {
          console.warn(`  Warning: JAR inspection failed for ${file.path}: ${e.message}`);
        }
      }

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
