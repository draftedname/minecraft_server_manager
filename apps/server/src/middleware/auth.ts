import { Request, Response, NextFunction } from "express";
import { hasPassword, verifyToken, verifyTicket } from "../services/AuthManager.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/auth/") || req.path.startsWith("/api/drive/oauth2callback") || req.path === "/api/drive/status") {
    next();
    return;
  }

  if (!hasPassword()) {
    next();
    return;
  }

  const ticket = req.query.ticket as string;
  if (ticket && verifyTicket(ticket)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);
  if (!verifyToken(token)) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  next();
}
