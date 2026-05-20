import { readdir, mkdir, copyFile, readFile, writeFile } from "fs/promises";
import path from "path";

export async function copyDirAsync(
  src: string,
  dest: string,
  concurrency: number = 8
): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  const queue = [...entries];

  const worker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await mkdir(destPath, { recursive: true });
        await copyDirAsync(srcPath, destPath, concurrency);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// Async worker-pool copy: reads files that are readable, silently skips locked ones (EBUSY)
export async function copyReadable(
  src: string,
  dest: string,
  concurrency: number = 8
): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });

  const dirs: { srcPath: string; destPath: string; name: string }[] = [];
  const files: { srcPath: string; destPath: string; name: string }[] = [];

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      dirs.push({ srcPath, destPath, name: entry.name });
    } else {
      if (entry.name === "session.lock" || entry.name.endsWith(".lock") || entry.name.endsWith(".lck")) continue;
      files.push({ srcPath, destPath, name: entry.name });
    }
  }

  await Promise.all(dirs.map((d) => mkdir(d.destPath, { recursive: true })));

  const queue = [...files];

  const worker = async () => {
    while (queue.length > 0) {
      const file = queue.shift()!;
      try {
        const data = await readFile(file.srcPath);
        await writeFile(file.destPath, data);
      } catch (err: any) {
        if (err.code === "EBUSY" || err.code === "EACCES" || err.code === "EPERM") continue;
        throw err;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  for (const d of dirs) {
    await copyReadable(d.srcPath, d.destPath, concurrency);
  }
}
