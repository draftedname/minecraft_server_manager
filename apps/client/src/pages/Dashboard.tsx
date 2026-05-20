import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, Square, RefreshCw, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import type { ServerConfig, ServerInfo } from "@mcservergui/shared";
import { useState, useEffect } from "react";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, ServerInfo>>({});

  const { data: servers, isLoading } = useQuery<ServerConfig[]>({
    queryKey: ["servers"],
    queryFn: async () => {
      const { data } = await api.get("/servers");
      return data;
    },
  });

  useEffect(() => {
    if (!servers) return;
    const interval = setInterval(async () => {
      const results: Record<string, ServerInfo> = {};
      for (const s of servers) {
        try {
          const { data } = await api.get(`/servers/${s.id}`);
          results[s.id] = data;
        } catch {
          // server might be deleted
        }
      }
      setStatuses(results);
    }, 3000);
    return () => clearInterval(interval);
  }, [servers]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      toast({ title: "Server deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete server", variant: "destructive" });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      await api.post(`/servers/${id}/${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
    onError: () => {
      toast({ title: "Action failed", variant: "destructive" });
    },
  });

  function statusBadge(status: string) {
    switch (status) {
      case "running":
        return <Badge variant="success">Running</Badge>;
      case "starting":
        return <Badge variant="default">Starting</Badge>;
      case "stopping":
        return <Badge variant="secondary">Stopping</Badge>;
      case "crashed":
        return <Badge variant="destructive">Crashed</Badge>;
      default:
        return <Badge variant="outline">Stopped</Badge>;
    }
  }

  function formatUptime(ms: number) {
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }

  if (isLoading) {
    return (
      <div className="p-8 text-muted-foreground">Loading...</div>
    );
  }

  if (!servers || servers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-lg text-muted-foreground">No servers yet</p>
        <Button onClick={() => navigate("/new")}>
          <Plus className="h-4 w-4" />
          Create Your First Server
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Servers</h1>
        <Button onClick={() => navigate("/new")}>
          <Plus className="h-4 w-4" />
          New Server
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => {
          const info = statuses[server.id];
          const status = info?.status || "stopped";

          return (
            <Card
              key={server.id}
              className="cursor-pointer transition-colors hover:bg-card/60"
              onClick={() => navigate(`/${server.id}/console`)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">{server.name}</CardTitle>
                {statusBadge(status)}
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span className="capitalize">{server.type === "modpack" ? "Modpack" : server.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Version:</span>
                    <span>{server.gameVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>RAM:</span>
                    <span>{server.ram} MB</span>
                  </div>
                  {info && info.status === "running" && (
                    <div className="flex justify-between">
                      <span>Uptime:</span>
                      <span>{formatUptime(info.uptime)}</span>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  {status === "stopped" || status === "crashed" ? (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        actionMutation.mutate({ id: server.id, action: "start" });
                      }}
                    >
                      <Play className="h-3 w-3" />
                      Start
                    </Button>
                  ) : status === "running" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          actionMutation.mutate({ id: server.id, action: "stop" });
                        }}
                      >
                        <Square className="h-3 w-3" />
                        Stop
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          actionMutation.mutate({ id: server.id, action: "restart" });
                        }}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Restart
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="w-full" disabled>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Busy
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(server.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
