// MC Server GUI
import { Router, Request, Response } from "express";
import {
  getNetworkState,
  enablePublicMode,
  disablePublicMode,
  getPlayitClaimUrl,
  isPlayitInstalled,
  refreshPlayitAddress,
} from "../services/NetworkManager.js";

const router = Router();

function p(params: any, key: string): string {
  return String(params[key]);
}

// Get network state for a server
router.get("/:serverId/network", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  res.json(getNetworkState(serverId));
});

// Enable public mode
router.post("/:serverId/network/enable", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const port = (req.body && req.body.port) || 25565;
  const state = await enablePublicMode(serverId, port);
  res.json(state);
});

// Toggle playit.gg usage
router.put("/:serverId/network/playit", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const state = getNetworkState(serverId);
  state.usePlayit = req.body.usePlayit !== false;
  res.json(state);
});

// Set the tunnel address manually
router.put("/:serverId/network/address", (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  const state = getNetworkState(serverId);
  state.address = req.body.address || null;
  res.json(state);
});

// Disable public mode
router.post("/:serverId/network/disable", async (req: Request, res: Response) => {
  const serverId = p(req.params, "serverId");
  await disablePublicMode(serverId);
  res.json({ success: true });
});

// Get playit claim URL
router.get("/playit/claim-url", async (_req: Request, res: Response) => {
  const url = await getPlayitClaimUrl();
  if (url) {
    res.json({ url });
  } else {
    res.status(500).json({ error: "Could not get playit claim URL" });
  }
});

// Check if playit is installed
router.get("/playit/status", (_req: Request, res: Response) => {
  res.json({ installed: isPlayitInstalled() });
});

export { router as networkRouter };

