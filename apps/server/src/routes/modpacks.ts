import { Router, Request, Response } from "express";
import { existsSync } from "fs";
import { loadServer, getServerDir, updateServer } from "../services/DataStore.js";
import { installModpack } from "../services/ModpackInstaller.js";
import type { ModpackInstallRequest } from "@mcservergui/shared";

const router = Router();

import { p } from "../lib/params.js";

router.post("/:serverId/install-modpack", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const server = loadServer(serverId);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const { versionId, modpackId, includeFiles } = req.body as ModpackInstallRequest;
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
    const includeSet = includeFiles?.length ? new Set<string>(includeFiles) : undefined;
    const result = await installModpack(serverDir, String(versionId), undefined, undefined, includeSet);

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
});

export { router as modpackRouter };
