import { readFileSync, existsSync } from "fs";
import path from "path";
import { SERVERS_DIR } from "./config.js";

export interface LogEntry {
  level: number;
  time: string | null;
  prefix: string;
  lines: { number: number; content: string }[];
}

export interface Problem {
  message: string;
  counter: number;
  entry: LogEntry;
  solutions: { message: string }[];
}

export interface Information {
  message: string;
  counter: number;
  label: string;
  value: string;
  entry: LogEntry;
}

export interface AnalyzeResult {
  id: string;
  name: string;
  type: string;
  version: string;
  title: string;
  analysis: {
    problems: Problem[];
    information: Information[];
  };
}

import { readLastLines } from "./readLastLines.js";

export function readServerLog(serverId: string): string {
  const logPath = path.join(SERVERS_DIR, serverId, "logs", "latest.log");
  if (!existsSync(logPath)) {
    return "";
  }
  return readLastLines(logPath, 5000, 1024 * 1024).join("\n");
}

export async function analyzeLogFile(logContent: string): Promise<AnalyzeResult> {
  const response = await fetch("https://api.mclo.gs/1/analyse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: logContent }),
  });

  if (!response.ok) {
    throw new Error(`mclo.gs API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<AnalyzeResult>;
}
