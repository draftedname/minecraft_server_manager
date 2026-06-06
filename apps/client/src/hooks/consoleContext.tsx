import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { getSocket } from "@/lib/socket";
import api from "@/lib/api";

export interface ConsoleLine {
  line: string;
  timestamp: number;
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
        const next = [...current, { line: data.line, timestamp: data.timestamp }];
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
    if (!socket.connected) socket.connect();
    socket.emit("console:subscribe", serverId);

    if (!activeServers.current.has(serverId)) {
      activeServers.current.add(serverId);
      api.get(`/servers/${serverId}/console-history`).then(({ data }) => {
        if (data.lines?.length > 0) {
          setLines((prev) => {
            const current = prev[serverId] || [];
            if (current.length === 0) {
              const now = Date.now();
              const historyLines: ConsoleLine[] = data.lines.map((l: string) => ({
                line: l,
                timestamp: now,
              }));
              return { ...prev, [serverId]: historyLines };
            }
            return prev;
          });
        }
      }).catch(() => {});
    }
  }, []);

  const unsubscribe = useCallback((serverId: string) => {
    const socket = getSocket();
    socket.emit("console:unsubscribe", serverId);
    activeServers.current.delete(serverId);
  }, []);

  return (
    <ConsoleContext.Provider value={{ lines, subscribe, unsubscribe }}>
      {children}
    </ConsoleContext.Provider>
  );
}
