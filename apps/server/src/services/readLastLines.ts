import { openSync, readSync, fstatSync, closeSync } from "fs";

export function readLastLines(filePath: string, maxLines: number = 1000, maxBytes: number = 256 * 1024): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const stat = fstatSync(fd);

    let buffer: Buffer;
    if (stat.size <= maxBytes) {
      buffer = Buffer.alloc(stat.size);
      readSync(fd, buffer, 0, stat.size, 0);
    } else {
      buffer = Buffer.alloc(maxBytes);
      readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
    }

    const text = buffer.toString("utf-8");
    const lines = text.split("\n");
    // If we only read a tail, the first line is likely partial — drop it
    // unless the buffer starts exactly at a newline boundary (first char is \n)
    if (stat.size > maxBytes && lines.length > 1 && text.charCodeAt(0) !== 10) {
      lines.shift();
    }
    // Remove only the trailing empty string from split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
}
