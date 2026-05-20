import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Square,
  RefreshCw,
  Server,
  Users,
  Clock,
  Activity,
  Cpu,
  HardDrive,
  Globe,
  Terminal,
  Package,
  FolderOpen,
} from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import NetworkCard from "@/components/NetworkCard";
import type { ServerConfig, ServerInfo } from "@mcservergui/shared";

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
  if (ms < 1000) return "0s";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatRAM(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export default function ServerDashboard() {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<ServerInfo | null>(null);

  const { data, isLoading, refetch } = useQuery<ServerInfo>({
    queryKey: ["server", serverId],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}`);
      return data;
    },
    enabled: !!serverId,
    refetchInterval: 2000,
  });

  const queryClient = useQueryClient();

  const ramMutation = useMutation({
    mutationFn: async (ram: number) => {
      await api.put(`/servers/${serverId}/ram`, { ram });
    },
    onSuccess: () => {
      toast({ title: "RAM updated" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update RAM", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (data) setInfo(data);
  }, [data]);

  const handleAction = async (action: string) => {
    try {
      await api.post(`/servers/${serverId}/${action}`);
      refetch();
    } catch (err: any) {
      toast({
        title: "Action failed",
        description: err.response?.data?.error || err.message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!info) {
    return <div className="p-8 text-muted-foreground">Server not found</div>;
  }

  const { config, status, uptime } = info;
  const isRunning = status === "running";
  const isStarting = status === "starting";

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{config.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{config.type === "modpack" ? "Modpack" : config.type}</span>
            <span>{config.gameVersion}</span>
            {config.loaderVersion && <span>Loader {config.loaderVersion}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {status === "stopped" || status === "crashed" ? (
            <Button onClick={() => handleAction("start")}>
              <Play className="h-4 w-4" />
              Start
            </Button>
          ) : status === "running" ? (
            <>
              <Button variant="outline" onClick={() => handleAction("stop")}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
              <Button variant="outline" onClick={() => handleAction("restart")}>
                <RefreshCw className="h-4 w-4" />
                Restart
              </Button>
            </>
          ) : (
            <Button disabled>
              <RefreshCw className="h-4 w-4 animate-spin" />
              {status === "starting" ? "Starting..." : "Stopping..."}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statusBadge(status)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isRunning ? formatUptime(uptime) : "--"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">RAM Allocated</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatRAM(config.ram)}</div>
            <p className="text-xs text-muted-foreground">
              {config.type === "modpack" ? "Modpack" : config.type === "vanilla" ? "Vanilla" : "Fabric"} server
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Server Port</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">25565</div>
            <p className="text-xs text-muted-foreground">localhost:25565</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">RAM Allocation</CardTitle>
                <CardDescription>
                  {isRunning ? "Stop the server to change RAM" : `${config.ram} MB (${(config.ram / 1024).toFixed(1)} GB)`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Slider
              value={[config.ram]}
              onValueChange={([v]) => {
                if (!isRunning) ramMutation.mutate(v);
              }}
              min={512}
              max={32768}
              step={128}
              disabled={isRunning}
              className={isRunning ? "opacity-50 cursor-not-allowed" : ""}
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>512 MB</span>
              <span>32 GB</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">
        <NetworkCard isRunning={isRunning} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Quick Access</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link to={`/${serverId}/console`}>
            <Card className="cursor-pointer transition-colors hover:bg-card/60">
              <CardContent className="flex items-center gap-3 p-4">
                <Terminal className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Console</p>
                  <p className="text-xs text-muted-foreground">View server output</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link to={`/${serverId}/mods`}>
            <Card className="cursor-pointer transition-colors hover:bg-card/60">
              <CardContent className="flex items-center gap-3 p-4">
                <Package className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Mods</p>
                  <p className="text-xs text-muted-foreground">Manage mods</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link to={`/${serverId}/worlds`}>
            <Card className="cursor-pointer transition-colors hover:bg-card/60">
              <CardContent className="flex items-center gap-3 p-4">
                <Globe className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Worlds</p>
                  <p className="text-xs text-muted-foreground">Backups</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link to={`/${serverId}/files`}>
            <Card className="cursor-pointer transition-colors hover:bg-card/60">
              <CardContent className="flex items-center gap-3 p-4">
                <FolderOpen className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Files</p>
                  <p className="text-xs text-muted-foreground">Browse files</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
