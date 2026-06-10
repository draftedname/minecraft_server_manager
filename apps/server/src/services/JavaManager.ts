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

export function checkJava(minVersion?: number): JavaInfo {
  // Check sandbox first (our managed Java)
  const localPath = findLocalJavaPath();
  if (localPath) {
    try {
      const result = spawnSync(`"${localPath}"`, ["-version"], { encoding: "utf-8", timeout: 10000, shell: true });
      const output = result.stderr || result.stdout || "";
      const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const actual = major === 1 ? parseInt(match[2], 10) : major;
        if (!minVersion || actual >= minVersion) {
          return { installed: true, version: match[0], path: localPath };
        }
      }
    } catch {}
  }

  // Fall back to system PATH
  try {
    const result = spawnSync("java", ["-version"], { encoding: "utf-8", timeout: 10000 });
    const output = result.stderr || result.stdout || "";
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
    const version = match ? match[0] : "unknown";

    if (minVersion && match) {
      const major = parseInt(match[1], 10);
      const actual = major === 1 ? parseInt(match[2], 10) : major;
      if (actual < minVersion) {
        return { installed: false, version: match[0], path: null };
      }
    }

    return { installed: true, version, path: "java" };
  } catch {}

  return { installed: false, version: null, path: null };
}

export async function downloadJava(
  version: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const javaDir = getJavaDir();
    onProgress?.("Preparing download...", 1, 3);

    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
    const arch = process.arch === "x64" ? "x64" : "aarch64";

    const apiUrl = `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?os=${platform}&architecture=${arch}&image_type=jdk`;

    const req = new Request(apiUrl);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    const response = await fetch(req, { signal: ctl.signal });
    clearTimeout(timer);
    if (!response.ok) return { success: false, error: `Failed to reach Adoptium (HTTP ${response.status})` };

    const data = await response.json() as Array<{
      binary: { package: { link: string; name: string } };
    }>;

    if (!data || data.length === 0) return { success: false, error: "No JDK found for this platform" };

    const binary = data[0].binary;
    const downloadUrl = binary.package.link;
    const isZip = binary.package.name.endsWith(".zip");
    const tempPath = path.join(javaDir, isZip ? "jdk.zip" : "jdk.tar.gz");

    onProgress?.("Downloading Java...", 2, 3);
    await downloadFile(downloadUrl, tempPath, onProgress);

    onProgress?.("Extracting Java...", 3, 3);

    let extractOk = false;
    if (isZip) {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${tempPath}' -DestinationPath '${javaDir}' -Force`], { stdio: "pipe" });
      if (r.status !== 0) {
        // Fallback: try tar on Windows 10 1803+
        const r2 = spawnSync("tar", ["-xf", tempPath, "-C", javaDir], { stdio: "pipe" });
        extractOk = r2.status === 0;
      } else {
        extractOk = true;
      }
    } else {
      const r = spawnSync("tar", ["-xzf", tempPath, "-C", javaDir], { stdio: "pipe" });
      extractOk = r.status === 0;
    }

    if (!extractOk) return { success: false, error: "Failed to extract JDK. Try installing Java manually from https://adoptium.net" };

    const entries = readdirSync(javaDir).filter((e) => e.startsWith("jdk"));
    if (entries.length === 0) return { success: false, error: "JDK extraction produced no files" };

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
    const finalPath = process.platform === "win32" ? javaPath + ".exe" : javaPath;
    if (!existsSync(finalPath)) return { success: false, error: "JDK installed but java binary not found" };

    onProgress?.("Java installed", 3, 3);
    return { success: true, path: finalPath };
  } catch (err: any) {
    console.error("Failed to download Java:", err);
    return { success: false, error: err.message || "Failed to download Java" };
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
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Download stalled — no data received for 20 seconds")), 20000)
      ),
    ]);
    const { done, value } = result;
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) {
      onProgress("Downloading Java — this may take a few minutes...", Math.min(received, total), total);
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
