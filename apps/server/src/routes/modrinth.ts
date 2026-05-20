// MC Server GUI
import { Router, Request, Response } from "express";
import {
  searchMods,
  getProject,
  getProjectVersions,
  getLatestCompatibleVersion,
} from "../services/ModrinthClient.js";

const router = Router();

router.get("/search", async (req: Request, res: Response) => {
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
      offset ? Number(offset) : undefined
    );
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/project/:id", async (req: Request, res: Response) => {
  try {
    const project = await getProject(String(req.params.id));
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/project/:id/versions", async (req: Request, res: Response) => {
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
});

router.get("/project/:id/latest", async (req: Request, res: Response) => {
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
});

export { router as modrinthRouter };

