import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, renameSync, chmodSync, rmSync } from "fs";
import path from "path";
import { DATA_DIR } from "./config.js";
import type { JavaInfo } from "@mcservergui/shared";

const JAVA_DIR = path.join(DATA_DIR, "java");

function getJavaDir(): string {
  if (!existsSync(JAVA_DIR)) mkdirSync(JAVA_DIR, { recursive: true });
  return JAVA_DIR;
}

export function findLocalJavaPath(): string | null {
  const javaDir = getJavaDir();
  if (!existsSync(javaDir)) return null;
  const entries = readdirSync(javaDir).filter((e) => e.startsWith("jdk-"));
  if (entries.length === 0) return null;
  const latest = entries.sort().reverse()[0];
  const p = path.join(javaDir, latest, "bin", "java");
  const pWin = p + ".exe";
  if (existsSync(p)) return p;
  if (existsSync(pWin)) return pWin;
  return null;
}

export function checkJava(): JavaInfo {
  try {
    const result = spawnSync("java", ["-version"], { encoding: "utf-8", timeout: 10000 });
    const output = result.stderr || result.stdout || "";
    const match = output.match(/(\d+\.\d+\.\d+)/);
    const version = match ? match[1] : "unknown";
    return {
      installed: true,
      version,
      path: findLocalJavaPath() || "java",
    };
  } catch {
    const localPath = findLocalJavaPath();
    if (localPath) {
      return {
        installed: true,
        version: "managed",
        path: localPath,
      };
    }
    return {
      installed: false,
      version: null,
      path: null,
    };
  }
}

export async function downloadJava(
  version: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ success: boolean; path?: string }> {
  try {
    const javaDir = getJavaDir();
    onProgress?.("Resolving Java version...", 0, 1);

    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
    const arch = process.arch === "x64" ? "x64" : "aarch64";

    const apiUrl = `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?os=${platform}&architecture=${arch}&image_type=jdk`;

    const response = await fetch(apiUrl);
    if (!response.ok) return { success: false };

    const data = await response.json() as Array<{
      binary: { package: { link: string; name: string } };
    }>;

    if (!data || data.length === 0) return { success: false };

    const binary = data[0].binary;
    const downloadUrl = binary.package.link;

    const tempPath = path.join(javaDir, "jdk.tar.gz");
    onProgress?.("Downloading Java...", 0, 100);
    await downloadFile(downloadUrl, tempPath, onProgress);

    const isZip = binary.package.name.endsWith(".zip");
    onProgress?.("Extracting Java...", 0, 100);

    if (isZip) {
      spawnSync("powershell", ["-Command", `Expand-Archive -Path '${tempPath}' -DestinationPath '${javaDir}' -Force`], { stdio: "ignore" });
    } else {
      spawnSync("tar", ["-xzf", tempPath, "-C", javaDir], { stdio: "ignore" });
    }

    const entries = readdirSync(javaDir).filter((e) => e.startsWith("jdk"));
    if (entries.length === 0) return { success: false };

    const extractedDir = path.join(javaDir, entries[0]);
    const targetDir = path.join(javaDir, `jdk-${version}`);

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    renameSync(extractedDir, targetDir);

    if (existsSync(tempPath)) unlinkSync(tempPath);

    if (process.platform !== "win32") {
      const javaBin = path.join(targetDir, "bin", "java");
      if (existsSync(javaBin)) chmodSync(javaBin, 0o755);
    }

    const javaPath = path.join(targetDir, "bin", "java");
    onProgress?.("Java ready", 100, 100);
    return { success: true, path: javaPath };
  } catch (err) {
    console.error("Failed to download Java:", err);
    return { success: false };
  }
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 100;
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) {
      onProgress("Downloading Java...", Math.min(received, total), total);
    }
  }

  const buffer = Buffer.concat(chunks);
  writeFileSync(dest, buffer);
}

export function getJavaPath(version?: string): string | null {
  if (version) {
    const p = path.join(getJavaDir(), `jdk-${version}`, "bin", "java");
    const pWin = p + ".exe";
    if (existsSync(p)) return p;
    if (existsSync(pWin)) return pWin;
  }
  return null;
}
