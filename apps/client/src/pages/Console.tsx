import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Send, Server, Filter, Bug, AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showAnalysis, setShowAnalysis] = useState(false);

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

  const { data: analysis, isLoading: analysisLoading, refetch: refetchAnalysis } = useQuery({
    queryKey: ["server", serverId, "log-analyze"],
    queryFn: async () => {
      const { data } = await api.post(`/servers/${serverId}/log-analyze`);
      return data;
    },
    enabled: !!serverId && showAnalysis,
  });

  useEffect(() => {
    if (!serverId) return;
    subscribe(serverId);
    return () => {
      unsubscribe(serverId);
    };
  }, [serverId]);

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

  const virtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 5,
  });

  useEffect(() => {
    if (autoScroll && filteredLines.length > 0) {
      virtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" });
    }
  }, [filteredLines.length, autoScroll]);

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="h-7 gap-1 text-xs"
          >
            <Bug className="h-3.5 w-3.5" />
            {showAnalysis ? "Console" : "Analyze"}
          </Button>
        </div>
      </div>

      {showAnalysis ? (
        <div className="flex-1 overflow-auto bg-black p-4 font-mono text-sm">
          {analysisLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing log...
            </div>
          ) : !analysis ? (
            <div className="text-muted-foreground">No analysis available</div>
          ) : (
            <div className="space-y-4">
              {analysis.title && (
                <div className="rounded border border-border p-3">
                  <p className="text-sm font-bold text-primary">{analysis.title}</p>
                  <p className="text-xs text-muted-foreground">{analysis.name} {analysis.version}</p>
                </div>
              )}

              {analysis.analysis?.problems?.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-bold text-red-400">
                    Problems ({analysis.analysis.problems.length})
                  </h3>
                  {analysis.analysis.problems.map((p: any, i: number) => (
                    <div key={i} className="mb-2 rounded border border-red-900/50 bg-red-950/20 p-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                        <div>
                          <p className="text-sm text-red-300">{p.message}</p>
                          {p.solutions?.length > 0 && p.solutions.map((s: any, j: number) => (
                            <p key={j} className="mt-1 text-xs text-green-400">
                              <CheckCircle2 className="mr-1 inline h-3 w-3" />
                              {s.message}
                            </p>
                          ))}
                          {p.counter > 1 && (
                            <p className="mt-1 text-xs text-muted-foreground">Occurred {p.counter} times</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-2">
                    <Button variant="outline" size="sm" onClick={() => refetchAnalysis()} className="h-7 gap-1 text-xs">
                      <Loader2 className="h-3.5 w-3.5" />
                      Refresh Analysis
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded border border-green-900/50 bg-green-950/20 p-3">
                  <p className="text-sm text-green-400">No problems detected</p>
                </div>
              )}

              {analysis.analysis?.information?.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-bold text-blue-400">
                    Information
                  </h3>
                  <div className="space-y-1">
                    {analysis.analysis.information.map((info: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 rounded border border-border p-2">
                        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" />
                        <div>
                          <p className="text-xs text-muted-foreground">{info.label}</p>
                          <p className="text-sm text-gray-300">{info.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          ref={parentRef}
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
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const entry = filteredLines[vi.index];
                const text = stripFormatting(entry.line);
                const cls = classifyLine(text);
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className={`absolute top-0 left-0 w-full whitespace-pre-wrap break-all leading-5 ${cls.color}`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {text}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
