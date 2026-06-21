import { Router, Request, Response } from "express";
import {
  getNetworkState,
  enablePublicMode,
  disablePublicMode,
} from "../services/NetworkManager.js";

const router = Router();

import { p } from "../lib/params.js";

router.get("/:serverId/network", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  res.json(getNetworkState(serverId));
});

router.post("/:serverId/network/enable", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const port = (req.body && req.body.port) || 25565;
  const state = await enablePublicMode(serverId, port);
  res.json(state);
});

router.put("/:serverId/network/address", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const state = getNetworkState(serverId);
  state.address = req.body.address || null;
  res.json(state);
});

router.post("/:serverId/network/disable", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  await disablePublicMode(serverId);
  res.json({ success: true });
});

export { router as networkRouter };
