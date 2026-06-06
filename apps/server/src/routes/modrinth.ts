import path from "path";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { Router, Request, Response } from "express";
import {
  searchMods,
  getProject,
  getProjectVersions,
  getLatestCompatibleVersion,
  getVersion,
  downloadModFile,
} from "../services/ModrinthClient.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = Router();

router.get("/search", asyncHandler(async (req: Request, res: Response) => {
  const { q, loader, version, serverSide, sort, categories, projectType, offset } = req.query;

  try {
    const categoryList = categories
      ? String(categories).split(",").map((c) => c.trim()).filter(Boolean)
      : undefined;

    const results = await searchMods(
      q ? String(q) : "",
      loader ? String(loader) : undefined,
      version ? String(version) : undefined,
      serverSide !== "false",
      sort ? String(sort) : undefined,
      categoryList,
      projectType ? String(projectType) : undefined,
      !isNaN(Number(offset)) ? Number(offset) : undefined
    );
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

router.get("/project/:id", asyncHandler(async (req: Request, res: Response) => {
  try {
    const project = await getProject(String(req.params.id));
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

router.get("/project/:id/versions", asyncHandler(async (req: Request, res: Response) => {
  const { loader, version } = req.query;
  try {
    const versions = await getProjectVersions(
      String(req.params.id),
      loader ? String(loader) : undefined,
      version ? String(version) : undefined
    );
    res.json(versions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

router.get("/project/:id/latest", asyncHandler(async (req: Request, res: Response) => {
  const { version: gameVersion, loader } = req.query;
  try {
    const latest = await getLatestCompatibleVersion(
      String(req.params.id),
      String(gameVersion || "1.20.1"),
      loader ? String(loader) : undefined
    );
    if (!latest) {
      res.status(404).json({ error: "No compatible version found" });
      return;
    }
    res.json(latest);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

router.get("/version/:versionId/contents", asyncHandler(async (req: Request, res: Response) => {
  const versionId = String(req.params.versionId);
  try {
    const version = await getVersion(versionId);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    const mrpackFile = version.files?.find((f: any) => f.filename?.endsWith(".mrpack"));
    if (!mrpackFile) {
      res.status(404).json({ error: "No .mrpack file found for this version" });
      return;
    }

    const tmpDir = mkdtempSync(path.join(tmpdir(), "mrpack-"));
    const mrpackPath = path.join(tmpDir, "pack.mrpack");

    await downloadModFile(mrpackFile.url, mrpackPath);

    const { default: extract } = await import("extract-zip");
    await extract(mrpackPath, { dir: tmpDir });

    const manifestPath = path.join(tmpDir, "modrinth.index.json");
    if (!existsSync(manifestPath)) {
      rmSync(tmpDir, { recursive: true, force: true });
      res.status(500).json({ error: "modrinth.index.json not found in mrpack" });
      return;
    }

    const manifestRaw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestRaw);

    rmSync(tmpDir, { recursive: true, force: true });

    res.json({
      name: manifest.name,
      gameVersion: version.game_versions?.[0] || manifest.dependencies?.minecraft || "",
      loader: manifest.dependencies?.["fabric-loader"] ? "fabric" : "vanilla",
      files: (manifest.files || []).map((f: any) => ({
        path: f.path,
        size: f.fileSize || 0,
        downloads: f.downloads?.[0] || null,
        env: f.env || null,
      })),
      fileCount: manifest.files?.length || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

export { router as modrinthRouter };
