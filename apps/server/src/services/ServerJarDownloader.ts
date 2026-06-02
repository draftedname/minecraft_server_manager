import { writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { getServerDir } from "./DataStore.js";

const VANILLA_MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META = "https://meta.fabricmc.net/v2/versions";

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.json();
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const parent = path.dirname(dest);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, buffer);
}

export async function downloadVanillaJar(serverId: string, gameVersion: string): Promise<string> {
  const serverDir = getServerDir(serverId);
  const jarPath = path.join(serverDir, "server.jar");

  const manifest = await fetchJson(VANILLA_MANIFEST);
  const versionEntry = manifest.versions.find((v: { id: string }) => v.id === gameVersion);
  if (!versionEntry) throw new Error(`Version ${gameVersion} not found in Mojang manifest`);

  const versionData = await fetchJson(versionEntry.url);
  const serverUrl = versionData.downloads?.server?.url;
  if (!serverUrl) throw new Error("Server download not available for " + gameVersion);

  await downloadFile(serverUrl, jarPath);
  return jarPath;
}

export async function downloadFabricJar(
  serverId: string,
  gameVersion: string,
  loaderVersion: string
): Promise<{ launchJar: string; classpath: string; mainClass: string }> {
  const serverDir = getServerDir(serverId);

  // 1. Download vanilla server jar
  const vanillaJar = path.join(serverDir, "server.jar");
  if (!existsSync(vanillaJar)) {
    await downloadVanillaJar(serverId, gameVersion);
  }

  // 2. Get Fabric loader profile (lists all libraries + main class)
  const profileUrl = `${FABRIC_META}/loader/${gameVersion}/${loaderVersion}`;
  const profile = await fetchJson(profileUrl);
  const launcherMeta = profile.launcherMeta;
  const mainClass = launcherMeta.mainClass.server;

  // 3. Download Fabric loader jar
  const loaderJar = `net/fabricmc/fabric-loader/${loaderVersion}/fabric-loader-${loaderVersion}.jar`;
  const loaderUrl = `https://maven.fabricmc.net/${loaderJar}`;
  const loaderPath = path.join(serverDir, "libraries", loaderJar);
  await downloadFile(loaderUrl, loaderPath);

  // 4. Download all libraries
  const libraries = [
    ...(launcherMeta.libraries.common || []),
    ...(launcherMeta.libraries.server || []),
  ];

  const libPaths: string[] = [];
  for (const lib of libraries) {
    const libPath = lib.name.replace(/\./g, "/");
    const parts = lib.name.split(":");
    const group = parts[0];
    const artifact = parts[1];
    const version = parts[2];
    // Check if maven URL contains a classifier
    const urlPath = `${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.jar`;

    // The lib.url might point to fabric's maven or other repos
    const fullUrl = lib.url ? `${lib.url}${urlPath}` : `https://maven.fabricmc.net/${urlPath}`;
    const destPath = path.join(serverDir, "libraries", urlPath);

    try {
      await downloadFile(fullUrl, destPath);
      libPaths.push(path.join(serverDir, "libraries", urlPath));
    } catch {
      console.log(`Skipping library: ${lib.name}`);
    }
  }

  // 5. Build classpath
  const sep = process.platform === "win32" ? ";" : ":";
  const cp = [loaderPath, vanillaJar, ...libPaths].map(p => path.resolve(p));
  const classpath = cp.join(sep);

  // 6. Save profile info for ServerManager
  const { writeFileSync } = await import("fs");
  writeFileSync(
    path.join(serverDir, "fabric-profile.json"),
    JSON.stringify({ classpath: cp, mainClass, loaderVersion, gameVersion }),
    "utf-8"
  );

  return { launchJar: vanillaJar, classpath, mainClass };
}

export async function getVanillaVersions(): Promise<string[]> {
  const manifest = await fetchJson(VANILLA_MANIFEST);
  return manifest.versions
    .filter((v: { type: string }) => v.type === "release")
    .map((v: { id: string }) => v.id);
}

export async function getFabricGameVersions(): Promise<string[]> {
  const data = await fetchJson(`${FABRIC_META}/game`);
  return data
    .filter((v: { stable: boolean }) => v.stable)
    .map((v: { version: string }) => v.version);
}

export async function getFabricLoaderVersions(): Promise<
  Array<{ version: string; stable: boolean }>
> {
  const data = await fetchJson(`${FABRIC_META}/loader`);
  return data.map((v: { version: string; stable: boolean }) => ({
    version: v.version,
    stable: v.stable,
  }));
}
