import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send, Server, Filter } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { useConsoleContext } from "@/hooks/consoleContext";
import type { ServerConfig } from "@mcservergui/shared";

type FilterMode = "all" | "important" | "chat" | "errors";

const CHAT_PATTERN = /^<\w+>/;
const ERROR_PATTERN = /\b(?:ERROR|FATAL|Exception|Caused by|FAILED)\b/;
const WARN_PATTERN = /\bWARN(?:ING)?\b/;
const JOIN_PATTERN = /\b(?:joined the game|logged in)\b/;
const LEAVE_PATTERN = /\b(?:left the game|disconnected|lost connection)\b/;
const ACHIEVEMENT_PATTERN = /\bhas (?:made the advancement|completed the challenge)\b/;
const DEATH_PATTERN = /\b(?:was slain|drowned|blew up|burned to death|fell from|hit the ground|starved to death|suffocated|withered away|froze to death|was killed|went up in flames|walked into|experienced kinetic|was squashed|was impaled|was fireballed|was stung|was pummeled|was shot|died)\b/;
const INFO_PATTERN = /^\[.*?\/INFO\]/;

function stripFormatting(line: string) {
  return line.replace(/\u001b\[[0-9;]*m/g, "");
}

function classifyLine(text: string): {
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

export default function Console() {
  const { serverId } = useParams<{ serverId: string }>();
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const { lines: allLines, subscribe, unsubscribe } = useConsoleContext();
  const lines = allLines[serverId || ""] || [];

  const { data: server } = useQuery<{ config: ServerConfig }>({
    queryKey: ["server", serverId],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}`);
      return data;
    },
    enabled: !!serverId,
  });

  useEffect(() => {
    if (!serverId) return;
    subscribe(serverId);
    return () => {
      unsubscribe(serverId);
    };
  }, [serverId]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const sendCommand = async () => {
    if (!command.trim() || !serverId) return;

    setHistory((prev) => [...prev, command]);
    setHistoryIdx(-1);

    try {
      await api.post(`/servers/${serverId}/command`, { command });
      setCommand("");
    } catch (err: any) {
      toast({ title: "Command failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    }

    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      sendCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setCommand(history[newIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === -1) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setCommand("");
      } else {
        setHistoryIdx(newIdx);
        setCommand(history[newIdx]);
      }
    }
  };

  const filteredLines = useMemo(() => {
    if (filterMode === "all") return lines;
    return lines.filter((entry) => {
      const text = stripFormatting(entry.line);
      const cls = classifyLine(text);
      switch (filterMode) {
        case "important":
          return cls.type !== "info";
        case "chat":
          return cls.type === "chat";
        case "errors":
          return cls.type === "error" || cls.type === "warn";
        default:
          return true;
      }
    });
  }, [lines, filterMode]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold">
              {server?.config.name || "Server"} Console
            </h1>
            <p className="text-xs text-muted-foreground">
              {server?.config.gameVersion} - {server?.config.type}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="important">Important</SelectItem>
              <SelectItem value="chat">Chat Only</SelectItem>
              <SelectItem value="errors">Errors Only</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredLines.length}/{lines.length}
          </span>
        </div>
      </div>

      <div
        className="flex-1 overflow-auto bg-black p-4 font-mono text-sm"
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg">Waiting for console output...</p>
              <p className="text-xs mt-2">Start the server from the Dashboard</p>
            </div>
          </div>
        ) : filteredLines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p>No lines match the current filter</p>
          </div>
        ) : (
          <>
            {filteredLines.map((entry, i) => {
              const text = stripFormatting(entry.line);
              const cls = classifyLine(text);

              return (
                <div key={`${entry.timestamp}-${i}`} className={`whitespace-pre-wrap break-all leading-5 ${cls.color}`}>
                  {text}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type command..."
            className="font-mono text-sm"
            autoFocus
          />
          <Button size="icon" onClick={sendCommand} disabled={!command.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter to send. Arrow Up/Down for history.
        </p>
      </div>
    </div>
  );
}
