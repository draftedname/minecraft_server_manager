import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, Square, RefreshCw, Trash2, Settings } from "lucide-react";
import api from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ServerInfo } from "@mcservergui/shared";
import { useState, useEffect } from "react";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [eulaServerId, setEulaServerId] = useState<string | null>(null);

  const { data: servers, isLoading } = useQuery<ServerInfo[]>({
    queryKey: ["servers", "status"],
    queryFn: async () => {
      const { data } = await api.get("/servers", { params: { status: "true" } });
      return data;
    },
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["servers", "status"] });
    };
    socket.on("server:status", handler);
    return () => { socket.off("server:status", handler); };
  }, [queryClient]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["servers", "status"] });
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
      queryClient.invalidateQueries({ queryKey: ["servers", "status"] });
    },
    onError: (err: any, variables: { id: string; action: string }) => {
      const error = err.response?.data?.error || err.message;
      if (error === "EULA_NOT_ACCEPTED") {
        setEulaServerId(variables.id);
        toast({ title: "Minecraft EULA must be accepted before starting" });
        setEulaOpen(true);
        return;
      }
      toast({ title: `Start failed: ${error}`, variant: "destructive" });
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
          const status = server.status || "stopped";

          return (
            <Card
              key={server.config.id}
              className="cursor-pointer transition-colors hover:bg-card/60"
              onClick={() => navigate(`/${server.config.id}`)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">{server.config.name}</CardTitle>
                {statusBadge(status)}
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span className="capitalize">{server.config.type === "modpack" ? "Modpack" : server.config.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Version:</span>
                    <span>{server.config.gameVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>RAM:</span>
                    <span>{server.config.ram} MB</span>
                  </div>
                  {server.status === "running" && (
                    <div className="flex justify-between">
                      <span>Uptime:</span>
                      <span>{formatUptime(server.uptime)}</span>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  {status === "stopped" || status === "crashed" ? (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={actionMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        actionMutation.mutate({ id: server.config.id, action: "start" });
                      }}
                    >
                      {actionMutation.isPending ? (
                        <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Play className="h-3 w-3 mr-1" />
                      )}
                      {actionMutation.isPending ? "Starting..." : "Start"}
                    </Button>
                  ) : status === "running" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          actionMutation.mutate({ id: server.config.id, action: "stop" });
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
                          actionMutation.mutate({ id: server.config.id, action: "restart" });
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
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/${server.config.id}/settings`);
                    }}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete({ id: server.config.id, name: server.config.name });
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

      <ConfirmDialog
        open={eulaOpen}
        title="Minecraft EULA"
        description="By starting this server, you accept the Minecraft End User License Agreement (EULA). Read it at https://aka.ms/MinecraftEULA."
        confirmLabel="Accept & Start"
        onConfirm={async () => {
          if (eulaServerId) {
            await api.post(`/servers/${eulaServerId}/eula/accept`);
            setEulaOpen(false);
            actionMutation.mutate({ id: eulaServerId, action: "start" });
          }
        }}
        onCancel={() => setEulaOpen(false)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete Server"
        description={`Delete "${pendingDelete?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete.id);
            setPendingDelete(null);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
