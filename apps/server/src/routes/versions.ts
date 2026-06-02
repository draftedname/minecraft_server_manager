import { Router, Request, Response } from "express";
import {
  getVanillaVersions,
  getFabricGameVersions,
  getFabricLoaderVersions,
} from "../services/ServerJarDownloader.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = Router();

router.get("/vanilla", asyncHandler(async (_req: Request, res: Response) => {
  try {
    const versions = await getVanillaVersions();
    res.json(versions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

router.get("/fabric/game", asyncHandler(async (_req: Request, res: Response) => {
  try {
    const versions = await getFabricGameVersions();
    res.json(versions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

router.get("/fabric/loader", asyncHandler(async (_req: Request, res: Response) => {
  try {
    const versions = await getFabricLoaderVersions();
    res.json(versions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

export { router as versionsRouter };
