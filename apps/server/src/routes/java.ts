import { Router, Request, Response } from "express";
import { checkJava, downloadJava, getJavaPath } from "../services/JavaManager.js";
import { getIO } from "../websocket/index.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = Router();

router.get("/status", (_req: Request, res: Response) => {
  const info = checkJava();
  res.json(info);
});

router.post("/install", asyncHandler(async (req: Request, res: Response) => {
  const { version } = req.body;
  if (!version) {
    res.status(400).json({ error: "Version is required (e.g., 17, 21)" });
    return;
  }

  try {
    const io = getIO();
    const emit = (msg: string, current: number, total: number) => {
      io?.emit("download:progress", { message: msg, current, total });
    };

    const result = await downloadJava(String(version), emit);
    if (result.success) {
      res.json({ success: true, path: result.path });
    } else {
      res.status(500).json({ error: "Failed to download Java" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

export { router as javaRouter };
