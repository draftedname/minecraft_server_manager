import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { getSocket } from "@/lib/socket";
import api from "@/lib/api";

export interface ConsoleLine {
  line: string;
  timestamp: number;
  text: string;
  type: "chat" | "error" | "warn" | "join" | "leave" | "achievement" | "death" | "info" | "normal";
  color: string;
}

const CHAT_PATTERN = /^<\w+>/;
const ERROR_PATTERN = /\b(?:ERROR|FATAL|Exception|Caused by|FAILED)\b/;
const WARN_PATTERN = /\bWARN(?:ING)?\b/;
const JOIN_PATTERN = /\b(?:joined the game|logged in)\b/;
const LEAVE_PATTERN = /\b(?:left the game|disconnected|lost connection)\b/;
const ACHIEVEMENT_PATTERN = /\bhas (?:made the advancement|completed the challenge)\b/;
const DEATH_PATTERN = /\b(?:was slain|drowned|blew up|burned to death|fell from|hit the ground|starved to death|suffocated|withered away|froze to death|was killed|went up in flames|walked into|experienced kinetic|was squashed|was impaled|was fireballed|was stung|was pummeled|was shot|died)\b/;
const INFO_PATTERN = /^\[.*?\/INFO\]/;

export function stripFormatting(line: string) {
  return line.replace(/\u001b\[[0-9;]*m/g, "");
}

export function classifyLine(text: string): {
  type: "chat" | "error" | "warn" | "join" | "leave" | "achievement" | "death" | "info" | "normal";
  color: string;
} {
  if (CHAT_PATTERN.test(text)) return { type: "chat", color: "text-cyan-400" };
  if (ERROR_PATTERN.test(text)) return { type: "error", color: "text-red-400" };
  if (WARN_PATTERN.test(text)) return { type: "warn", color: "text-yellow-400" };
  if (ACHIEVEMENT_PATTERN.test(text)) return { type: "achievement", color: "text-purple-400" };
  if (JOIN_PATTERN.test(text)) return { type: "join", color: "text-green-400" };
  if (LEAVE_PATTERN.test(text)) return { type: "leave", color: "text-orange-400" };
  if (DEATH_PATTERN.test(text)) return { type: "death", color: "text-red-300" };
  if (INFO_PATTERN.test(text)) return { type: "info", color: "text-gray-500" };
  return { type: "normal", color: "text-gray-300" };
}

interface ConsoleContextType {
  lines: Record<string, ConsoleLine[]>;
  subscribe: (serverId: string) => void;
  unsubscribe: (serverId: string) => void;
}

const ConsoleContext = createContext<ConsoleContextType>({
  lines: {},
  subscribe: () => {},
  unsubscribe: () => {},
});

export function useConsoleContext() {
  return useContext(ConsoleContext);
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<Record<string, ConsoleLine[]>>({});
  const activeServers = useRef<Set<string>>(new Set());

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const handler = (data: ConsoleLine & { serverId: string }) => {
      const sid = data.serverId;
      setLines((prev) => {
        const current = prev[sid] || [];
        const text = stripFormatting(data.line);
        const cls = classifyLine(text);
        const next = [...current, { line: data.line, timestamp: data.timestamp, text, type: cls.type, color: cls.color }];
        if (next.length > 5000) next.splice(0, next.length - 5000);
        return { ...prev, [sid]: next };
      });
    };

    socket.on("console:output", handler);

    return () => {
      socket.off("console:output", handler);
    };
  }, []);

  const subscribe = useCallback((serverId: string) => {
    const socket = getSocket();
    if (!socket.connected) return;
    socket.emit("server:subscribe", serverId);

    if (!activeServers.current.has(serverId)) {
      activeServers.current.add(serverId);
      api.get(`/servers/${serverId}/console-history`).then(({ data }) => {
        if (data.lines?.length > 0) {
          const now = Date.now();
          const historyLines: ConsoleLine[] = data.lines.map((l: string) => {
            const text = stripFormatting(l);
            const cls = classifyLine(text);
            return {
              line: l,
              timestamp: now,
              text,
              type: cls.type,
              color: cls.color,
            };
          });
          setLines((prev) => ({ ...prev, [serverId]: historyLines }));
        }
      }).catch(() => {});
    }
  }, []);

  const unsubscribe = useCallback((serverId: string) => {
    const socket = getSocket();
    if (!socket.connected) return;
    socket.emit("server:unsubscribe", serverId);
    activeServers.current.delete(serverId);
  }, []);

  return (
    <ConsoleContext.Provider value={{ lines, subscribe, unsubscribe }}>
      {children}
    </ConsoleContext.Provider>
  );
}
