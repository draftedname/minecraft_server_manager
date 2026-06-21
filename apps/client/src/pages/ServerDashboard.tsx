import { useEffect, useRef, useState } from "react";
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
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NetworkCard from "@/components/NetworkCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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

  const { data, isLoading, refetch } = useQuery<ServerInfo>({
    queryKey: ["server", serverId],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}`);
      return data;
    },
    enabled: !!serverId,
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!serverId) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const handler = (data: { serverId: string }) => {
      if (data.serverId === serverId) {
        queryClient.refetchQueries({ queryKey: ["server", serverId] });
      }
    };
    socket.on("server:status", handler);
    return () => { socket.off("server:status", handler); };
  }, [serverId, queryClient]);

  useEffect(() => {
    if (data?.status === "running") {
      const id = setInterval(() => setTick((t) => t + 1), 1000);
      return () => clearInterval(id);
    }
  }, [data?.status]);

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

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [pendingLoader, setPendingLoader] = useState<string | null>(null);
  const [editingRam, setEditingRam] = useState(false);
  const [ramInput, setRamInput] = useState(0);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startMsg, setStartMsg] = useState("Start");
  const startingRef = useRef(starting);
  startingRef.current = starting;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!serverId) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const handler = (data: { message: string; current: number; total: number }) => {
      if (startingRef.current) {
        const pct = data.total > 1 ? ` (${Math.round(Math.min(data.current / data.total, 1) * 100)}%)`
          : !data.message.includes("installed") ? "..." : "";
        setStartMsg(data.message + pct);
      }
    };
    socket.on("download:progress", handler);
    return () => { socket.off("download:progress", handler); };
  }, [serverId]);

  const renameMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.put(`/servers/${serverId}/name`, { name });
    },
    onSuccess: () => {
      setEditingName(false);
      queryClient.invalidateQueries({ queryKey: ["server", serverId] });
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      toast({ title: "Server renamed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to rename", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [targetVersion, setTargetVersion] = useState("");
  const [targetLoaderVersion, setTargetLoaderVersion] = useState("");
  const [preflightResult, setPreflightResult] = useState<any>(null);
  const [incompatibleAction, setIncompatibleAction] = useState<"disable" | "delete">("disable");

  const updateVersionMutation = useMutation({
    mutationFn: async (version: string) => {
      await api.post(`/servers/${serverId}/update-version`, { targetVersion: version });
    },
    onSuccess: () => {
      toast({ title: "Server version updated!" });
      setVersionDialogOpen(false);
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update version", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const preflightMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/servers/${serverId}/update-fabric/preflight`, { targetVersion });
      return data;
    },
    onSuccess: (data) => {
      setPreflightResult(data);
    },
    onError: (err: any) => {
      toast({ title: "Pre-flight check failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const executeFabricMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/servers/${serverId}/update-fabric/execute`, {
        targetVersion,
        targetLoaderVersion,
        incompatibleAction,
        upgradable: preflightResult?.upgradable || [],
        incompatible: preflightResult?.incompatible || [],
      });
    },
    onSuccess: () => {
      toast({ title: "Fabric server updated!" });
      setVersionDialogOpen(false);
      setPreflightResult(null);
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update Fabric", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const { data: vanillaVersions } = useQuery<string[]>({
    queryKey: ["versions", "vanilla"],
    queryFn: async () => {
      const { data } = await api.get("/versions/vanilla");
      return data;
    },
    enabled: versionDialogOpen,
  });

  const { data: loaderVersions } = useQuery<Array<{ version: string; stable: boolean }>>({
    queryKey: ["versions", "fabric", "loader"],
    queryFn: async () => {
      const { data } = await api.get("/versions/fabric/loader");
      return data;
    },
    enabled: !!serverId && (data?.config?.type === "fabric" || data?.config?.type === "modpack"),
  });

  const loaderMutation = useMutation({
    mutationFn: async (loaderVersion: string) => {
      await api.put(`/servers/${serverId}/loader`, { loaderVersion });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId] });
      toast({ title: "Loader version updated. Restart to apply." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update loader", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const handleAction = async (action: string) => {
    if (action === "start") { setStarting(true); setStartMsg("Starting..."); }
    try {
      await api.post(`/servers/${serverId}/${action}`);
      await refetch();
    } catch (err: any) {
      const error = err.response?.data?.error || err.message;
      if (error === "EULA_NOT_ACCEPTED") {
        toast({ title: "Minecraft EULA must be accepted before starting" });
        setEulaOpen(true);
        setStarting(false);
        setStartMsg("Start");
        return;
      }
      toast({ title: `Start failed: ${error}`, description: JSON.stringify(err.response?.data || {}), variant: "destructive" });
    } finally {
      startingRef.current = false;
      setStarting(false);
      setStartMsg("Start");
    }
  };

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!data) {
    return <div className="p-8 text-muted-foreground">Server not found</div>;
  }

  const { config, status, uptime } = data;
  const isRunning = status === "running";
  const localUptime = isRunning && config.lastStartedAt
    ? Date.now() - new Date(config.lastStartedAt).getTime()
    : uptime;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          {editingName ? (
            <input
              className="text-2xl font-bold bg-transparent border-b border-primary outline-none"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameInput.trim()) renameMutation.mutate(nameInput.trim());
                if (e.key === "Escape") setEditingName(false);
              }}
              onBlur={() => setEditingName(false)}
              autoFocus
            />
          ) : (
            <h1
              className="text-2xl font-bold cursor-pointer hover:text-primary transition-colors"
              onClick={() => { setNameInput(config.name); setEditingName(true); }}
              title="Click to rename"
            >
              {config.name}
            </h1>
          )}
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{config.type === "modpack" ? "Modpack" : config.type}</span>
            <span>{config.gameVersion}</span>
            {(config.type === "vanilla" || config.type === "fabric") && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-5 px-2 text-[10px] ml-1"
                disabled={isRunning}
                onClick={() => {
                  setTargetVersion("");
                  setPreflightResult(null);
                  setTargetLoaderVersion(config?.loaderVersion || "");
                  setVersionDialogOpen(true);
                }}
                title={isRunning ? "Stop the server to change version" : "Change Version"}
              >
                Change
              </Button>
            )}
            {(config.type === "fabric" || config.type === "modpack") && loaderVersions && (
              <Select value={config.loaderVersion || ""} onValueChange={(v) => setPendingLoader(v)} disabled={loaderMutation.isPending || isRunning}>
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue placeholder="Loader" />
                </SelectTrigger>
                <SelectContent>
                  {loaderVersions.map((v) => (
                    <SelectItem key={v.version} value={v.version}>{v.version} {v.stable ? "" : "(unstable)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {status === "stopped" || status === "crashed" ? (
            <Button onClick={() => handleAction("start")} disabled={starting}>
              {starting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {startMsg}
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
            <div className="text-2xl font-bold">{isRunning ? formatUptime(localUptime) : "--"}</div>
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
            {editingRam ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={ramInput}
                  onChange={(e) => setRamInput(parseInt(e.target.value, 10) || 0)}
                  min={512}
                  max={32768}
                  step={128}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">MB</span>
                <Button
                  size="sm"
                  onClick={() => {
                    const v = Math.max(512, Math.min(32768, ramInput));
                    setRamInput(v);
                    ramMutation.mutate(v, {
                      onSuccess: () => setEditingRam(false),
                      onError: () => setEditingRam(false),
                    });
                  }}
                  disabled={ramMutation.isPending || ramInput < 512 || ramInput > 32768}
                >
                  Save
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditingRam(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{config.ram} MB</span>
                <span className="text-xs text-muted-foreground">
                  ({(config.ram / 1024).toFixed(1)} GB)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setRamInput(config.ram); setEditingRam(true); }}
                  disabled={isRunning}
                >
                  Change
                </Button>
              </div>
            )}
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
                  <p className="font-medium">{config.type === "vanilla" ? "Datapacks" : "Mods"}</p>
                  <p className="text-xs text-muted-foreground">{config.type === "vanilla" ? "Manage datapacks" : "Manage mods"}</p>
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

      <ConfirmDialog
        open={eulaOpen}
        title="Minecraft EULA"
        description="By starting this server, you accept the Minecraft End User License Agreement (EULA). Read it at https://aka.ms/MinecraftEULA."
        confirmLabel="Accept & Start"
        onConfirm={async () => {
          await api.post(`/servers/${serverId}/eula/accept`);
          setEulaOpen(false);
          handleAction("start");
        }}
        onCancel={() => setEulaOpen(false)}
      />

      <ConfirmDialog
        open={!!pendingLoader}
        title="Change Loader Version"
        description={`Change loader to ${pendingLoader}? This will re-download the Fabric loader and libraries.`}
        confirmLabel="Change"
        onConfirm={() => {
          if (pendingLoader) {
            loaderMutation.mutate(pendingLoader);
            setPendingLoader(null);
          }
        }}
        onCancel={() => setPendingLoader(null)}
      />
      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Server Version</DialogTitle>
            <DialogDescription>
              Select a new version. {config.type === "vanilla" ? "This will download the new server.jar." : "We will verify mod compatibility before upgrading."}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded border border-red-900/50 bg-red-950/20 p-3 mb-2 mt-2">
            <div className="flex items-start gap-2">
              <div className="text-sm text-red-300">
                <span className="font-bold">Warning:</span> Worlds are not completely backwards compatible. Skipping major versions can corrupt chunks. Please create a Backup first!
              </div>
            </div>
          </div>

          {!preflightResult ? (
            <div className="grid gap-4 py-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Target Game Version</label>
                <Select value={targetVersion} onValueChange={setTargetVersion}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {vanillaVersions?.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {config.type === "fabric" && loaderVersions && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Target Loader Version</label>
                  <Select value={targetLoaderVersion} onValueChange={setTargetLoaderVersion}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select loader" />
                    </SelectTrigger>
                    <SelectContent>
                      {loaderVersions.map((v) => (
                        <SelectItem key={v.version} value={v.version}>
                          {v.version} {v.stable && "(Stable)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
            <div className="py-2 space-y-4 text-sm">
              <div className="bg-green-500/10 text-green-500 border border-green-500/20 rounded p-3">
                <p className="font-bold mb-1">✅ {preflightResult.upgradable.length} Mods Compatible</p>
                <p className="text-xs text-green-500/80">These mods will be automatically downloaded and updated.</p>
              </div>

              {preflightResult.incompatible.length > 0 ? (
                <div className="bg-red-500/10 text-red-500 border border-red-500/20 rounded p-3">
                  <p className="font-bold mb-1">❌ {preflightResult.incompatible.length} Mods Incompatible</p>
                  <p className="text-xs text-red-500/80 mb-3">No compatible version was found for the new game version.</p>
                  
                  <div className="space-y-2">
                    <label className="text-red-500 font-semibold">Action for incompatible mods:</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer font-normal text-red-500">
                        <input type="radio" checked={incompatibleAction === "disable"} onChange={() => setIncompatibleAction("disable")} />
                        Disable them (.disabled)
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer font-normal text-red-500">
                        <input type="radio" checked={incompatibleAction === "delete"} onChange={() => setIncompatibleAction("delete")} />
                        Delete completely
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                 <div className="bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded p-3">
                  All installed mods are fully compatible with this version!
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDialogOpen(false)} disabled={updateVersionMutation.isPending || preflightMutation.isPending || executeFabricMutation.isPending}>
              Cancel
            </Button>
            
            {!preflightResult ? (
              <Button
                onClick={() => {
                  if (config.type === "fabric") {
                    preflightMutation.mutate();
                  } else {
                    updateVersionMutation.mutate(targetVersion);
                  }
                }}
                disabled={!targetVersion || updateVersionMutation.isPending || preflightMutation.isPending || targetVersion === config.gameVersion}
              >
                {config.type === "fabric" ? (preflightMutation.isPending ? "Checking..." : "Check Compatibility") : (updateVersionMutation.isPending ? "Updating..." : "Update")}
              </Button>
            ) : (
              <Button
                onClick={() => executeFabricMutation.mutate()}
                disabled={executeFabricMutation.isPending}
              >
                {executeFabricMutation.isPending ? "Executing..." : "Execute Upgrade"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
