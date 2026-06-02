import path from "path";

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

export function safeJoin(baseDir: string, ...segments: string[]): string {
  const resolved = path.resolve(baseDir, ...segments);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new PathTraversalError(`Path traversal blocked: ${resolved} is outside ${normalizedBase}`);
  }
  return resolved;
}
