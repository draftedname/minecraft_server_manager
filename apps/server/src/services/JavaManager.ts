import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { DATA_DIR } from "./config.js";
import type { JavaInfo } from "@mcservergui/shared";

const JAVA_DIR = path.join(DATA_DIR, "java");

function getJavaDir(): string {
  if (!existsSync(JAVA_DIR)) mkdirSync(JAVA_DIR, { recursive: true });
  return JAVA_DIR;
}

export function checkJava(): JavaInfo {
  try {
    const output = execSync('java -version 2>&1', { encoding: "utf-8", timeout: 10000 });
    const match = output.match(/(\d+\.\d+\.\d+)/);
    const version = match ? match[1] : "unknown";
    return {
      installed: true,
      version,
      path: "java",
    };
  } catch {
    const localJava = path.join(JAVA_DIR, "bin", "java");
    const localJavaWin = localJava + ".exe";
    if (existsSync(localJava) || existsSync(localJavaWin)) {
      return {
        installed: true,
        version: "managed",
        path: localJava,
      };
    }
    return {
      installed: false,
      version: null,
      path: null,
    };
  }
}

export async function downloadJava(version: string): Promise<{ success: boolean; path?: string }> {
  const javaDir = getJavaDir();

  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "x64" ? "x64" : "aarch64";

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?os=${platform}&architecture=${arch}&image_type=jdk`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    return { success: false };
  }

  const data = await response.json() as Array<{
    binary: { package: { link: string; name: string } };
  }>;

  if (!data || data.length === 0) {
    return { success: false };
  }

  const binary = data[0].binary;
  const downloadUrl = binary.package.link;

  const tempPath = path.join(javaDir, "jdk.tar.gz");
  await downloadFile(downloadUrl, tempPath);

  // For Windows, use .zip format from the API
  // The Adoptium API can return ZIP for Windows
  const isZip = binary.package.name.endsWith(".zip");

  if (isZip) {
    // Extract with PowerShell
    const { execSync } = await import("child_process");
    execSync(`powershell -Command "Expand-Archive -Path '${tempPath}' -DestinationPath '${javaDir}' -Force"`, { stdio: "ignore" });
  } else {
    // tar.gz - extract with node
    const { execSync } = await import("child_process");
    execSync(`tar -xzf "${tempPath}" -C "${javaDir}"`, { stdio: "ignore" });
  }

  // Find the extracted directory
  const { readdirSync, unlinkSync, renameSync, chmodSync } = await import("fs");

  const entries = readdirSync(javaDir).filter((e) => e.startsWith("jdk"));
  if (entries.length === 0) {
    return { success: false };
  }

  // Rename to a standard name
  const extractedDir = path.join(javaDir, entries[0]);
  const targetDir = path.join(javaDir, `jdk-${version}`);

  if (existsSync(targetDir)) {
    const { rmSync } = await import("fs");
    rmSync(targetDir, { recursive: true, force: true });
  }

  renameSync(extractedDir, targetDir);

  // Clean up temp file
  if (existsSync(tempPath)) unlinkSync(tempPath);

  // Make java executable on unix
  if (process.platform !== "win32") {
    const javaBin = path.join(targetDir, "bin", "java");
    if (existsSync(javaBin)) chmodSync(javaBin, 0o755);
  }

  const javaPath = path.join(targetDir, "bin", "java");
  return { success: true, path: javaPath };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
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
