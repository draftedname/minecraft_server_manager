import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { hasPassword, setPassword, verifyPassword, generateToken, createTicket } from "../services/AuthManager.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Try again in a minute." },
});

router.get("/auth/status", (req: Request, res: Response) => {
  res.json({ setup: hasPassword() });
});

router.post("/auth/set-password", (req: Request, res: Response) => {
  if (hasPassword()) {
    res.status(400).json({ error: "Password already set" });
    return;
  }
  const { password } = req.body;
  if (!password || password.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters" });
    return;
  }
  setPassword(password);
  const token = generateToken();
  res.json({ token });
});

router.post("/auth/login", loginLimiter, (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    res.status(400).json({ error: "Password is required" });
    return;
  }
  if (!verifyPassword(password)) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  const token = generateToken();
  res.json({ token });
});

export { router as authRouter };

const ticketRouter = Router();
ticketRouter.get("/ticket", (req: Request, res: Response) => {
  res.json({ ticket: createTicket() });
});

export { ticketRouter };
