import { Router, Request, Response } from "express";
import { existsSync } from "fs";
import { loadServer, getServerDir, updateServer } from "../services/DataStore.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { installModpack } from "../services/ModpackInstaller.js";

const router = Router();

import { p } from "../lib/params.js";

router.post("/:serverId/install-modpack", asyncHandler(async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { versionId, modpackId } = req.body;
  if (!versionId) {
    res.status(400).json({ error: "versionId is required" });
    return;
  }

  const serverDir = getServerDir(serverId);
  if (!existsSync(serverDir)) {
    res.status(404).json({ error: "Server directory not found" });
    return;
  }

  try {
    const includeFiles = req.body.includeFiles?.length ? new Set<string>(req.body.includeFiles) : undefined;
    const result = await installModpack(serverDir, String(versionId), undefined, undefined, includeFiles);

    await updateServer(serverId, {
      gameVersion: result.gameVersion,
      type: result.loader === "fabric" ? "fabric" : "vanilla",
      loaderVersion: result.loaderVersion,
      modpackId: String(modpackId || ""),
      modpackVersionId: String(versionId),
    });

    res.json({
      success: true,
      gameVersion: result.gameVersion,
      loader: result.loader,
      loaderVersion: result.loaderVersion,
      modsInstalled: result.modResults.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

export { router as modpackRouter };
