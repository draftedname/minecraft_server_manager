import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { DATA_DIR } from "./config.js";

const AUTH_DIR = path.join(DATA_DIR, "auth");
const PASSWORD_PATH = path.join(AUTH_DIR, "password.hash");
const JWT_SECRET_PATH = path.join(AUTH_DIR, "jwt.secret");

function ensureAuthDir(): void {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
}

function getJwtSecret(): string {
  ensureAuthDir();
  if (!existsSync(JWT_SECRET_PATH)) {
    const secret = crypto.randomBytes(64).toString("hex");
    writeFileSync(JWT_SECRET_PATH, secret, "utf-8");
    return secret;
  }
  return readFileSync(JWT_SECRET_PATH, "utf-8");
}

export function hasPassword(): boolean {
  ensureAuthDir();
  return existsSync(PASSWORD_PATH);
}

export function setPassword(password: string): void {
  ensureAuthDir();
  const hash = bcrypt.hashSync(password, 12);
  writeFileSync(PASSWORD_PATH, hash, "utf-8");
}

export function verifyPassword(password: string): boolean {
  if (!existsSync(PASSWORD_PATH)) {
    return true;
  }
  const hash = readFileSync(PASSWORD_PATH, "utf-8");
  return bcrypt.compareSync(password, hash);
}

export function generateToken(): string {
  const secret = getJwtSecret();
  return jwt.sign({}, secret, { expiresIn: "24h" });
}

export function verifyToken(token: string): boolean {
  try {
    const secret = getJwtSecret();
    jwt.verify(token, secret);
    return true;
  } catch {
    return false;
  }
}

const activeTickets = new Map<string, number>();

export function createTicket(): string {
  const ticket = uuid();
  activeTickets.set(ticket, Date.now() + 60000); // Valid for 60 seconds
  return ticket;
}

export function verifyTicket(ticket: string): boolean {
  const expiresAt = activeTickets.get(ticket);
  if (!expiresAt) return false;
  
  if (Date.now() > expiresAt) {
    activeTickets.delete(ticket);
    return false;
  }
  
  // A ticket can only be used once
  activeTickets.delete(ticket);
  return true;
}
