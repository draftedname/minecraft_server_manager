// MC Server GUI
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  Copy,
  Loader2,
  ExternalLink,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import api from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toaster";

interface NetworkState {
  enabled: boolean;
  mode: "playit" | "none";
  address: string | null;
  playitClaimUrl: string | null;
  playitLinked: boolean;
  usePlayit: boolean;
  error: string | null;
}

export default function NetworkCard({ isRunning }: { isRunning: boolean }) {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();
  const [guideOpen, setGuideOpen] = useState(false);

  const { data: netState, isLoading } = useQuery<NetworkState>({
    queryKey: ["server", serverId, "network"],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}/network`);
      return data;
    },
    enabled: !!serverId,
    refetchInterval: 5000,
  });

  // Listen for real-time state broadcasts from the backend
  useEffect(() => {
    if (!serverId) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.emit("console:subscribe", serverId);

    const handler = (state: NetworkState) => {
      queryClient.setQueryData(["server", serverId, "network"], state);
    };
    socket.on("network:state", handler);

    return () => {
      socket.off("network:state", handler);
    };
  }, [serverId, queryClient]);

  const enableMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/servers/${serverId}/network/enable`);
      return data as NetworkState;
    },
    onSuccess: (data) => {
      if (data.address) {
        toast({ title: "Tunnel established!" });
      } else if (data.playitClaimUrl) {
        toast({ title: "playit.gg ready. Claim your account first." });
        setGuideOpen(true);
      } else if (data.error) {
        toast({ title: "Setup needed", description: "Follow the guide to configure playit.gg", variant: "default" });
        setGuideOpen(true);
      }
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "network"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.response?.data?.error, variant: "destructive" });
      setGuideOpen(true);
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/servers/${serverId}/network/disable`);
    },
    onSuccess: () => {
      toast({ title: "Public mode disabled" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "network"] });
    },
  });

  const togglePlayitMutation = useMutation({
    mutationFn: async (usePlayit: boolean) => {
      await api.put(`/servers/${serverId}/network/playit`, { usePlayit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "network"] });
    },
  });

  const setAddressMutation = useMutation({
    mutationFn: async (address: string) => {
      await api.put(`/servers/${serverId}/network/address`, { address });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "network"] });
    },
  });

  const copyAddress = () => {
    if (netState?.address) {
      navigator.clipboard.writeText(netState.address);
      toast({ title: "Address copied!" });
    }
  };

  if (isLoading) return null;
  if (!netState) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {netState.enabled && netState.address ? (
                  <Wifi className="h-4 w-4 text-green-400" />
                ) : netState.enabled ? (
                  <Wifi className="h-4 w-4 text-yellow-400" />
                ) : (
                  <WifiOff className="h-4 w-4 text-muted-foreground" />
                )}
                Networking
              </CardTitle>
              <CardDescription>
                {!isRunning
                  ? "Start the server first"
                  : netState.address
                  ? "Server is publicly accessible"
                  : netState.enabled
                  ? "Setting up..."
                  : "Allow friends to join"}
              </CardDescription>
            </div>
            <Switch
              checked={netState.enabled}
              onCheckedChange={(v) => {
                if (v) enableMutation.mutate();
                else disableMutation.mutate();
              }}
              disabled={!isRunning || enableMutation.isPending || disableMutation.isPending}
            />
          </div>
        </CardHeader>

        {netState.enabled && (
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="use-playit" className="text-xs cursor-pointer">Use playit.gg tunnel</Label>
              </div>
              <Switch
                id="use-playit"
                checked={netState.usePlayit ?? true}
                onCheckedChange={(v) => togglePlayitMutation.mutate(v)}
              />
            </div>
            {!netState.usePlayit && (
              <p className="text-xs text-muted-foreground">
                Direct connection. Set up port forwarding on your router (port 25565 TCP). Friends connect using your public IP.
              </p>
            )}

            {netState.enabled && netState.usePlayit && !netState.address && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Server Address</Label>
                <p className="text-xs text-muted-foreground">Copy from playit's window and paste below.</p>
                <Input
                  placeholder="e.g. copper-pig.gl.joinmc.link"
                  className="font-mono text-sm"
                  onBlur={(e) => {
                    if (e.target.value.trim()) setAddressMutation.mutate(e.target.value.trim());
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                      setAddressMutation.mutate((e.target as HTMLInputElement).value.trim());
                    }
                  }}
                />
              </div>
            )}

            {netState.address && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Server Address</Label>
                <div className="flex gap-2">
                  <Input value={netState.address} readOnly className="font-mono text-sm flex-1" />
                  <Button size="icon" variant="outline" onClick={copyAddress}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {(enableMutation.isPending || disableMutation.isPending) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {enableMutation.isPending ? "Establishing tunnel..." : "Disabling..."}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>playit.gg Setup Guide</DialogTitle>
            <DialogDescription>
              Follow these steps to make your server publicly accessible.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div className="space-y-3">
              <div className="flex gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground flex-shrink-0">1</span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Create a playit.gg account</p>
                  <p className="text-xs text-muted-foreground">
                    Go to{" "}
                    <a href="https://playit.gg/account" target="_blank" className="text-primary underline">playit.gg/account</a>
                    {" "}and sign up or log in. You can use Google, Discord, or GitHub.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => window.open("https://playit.gg/account", "_blank")}>
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open playit.gg
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground flex-shrink-0">2</span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Download the playit agent</p>
                  <p className="text-xs text-muted-foreground">
                    If the auto-download failed, get it from{" "}
                    <a href="https://playit.gg/download" target="_blank" className="text-primary underline">playit.gg/download</a>
                    {" "}and place the .exe at:
                  </p>
                  <code className="block text-xs bg-background-hover p-1.5 rounded select-all">
                    data\playit\playit.exe
                  </code>
                </div>
              </div>

              <Separator />

              <div className="flex gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground flex-shrink-0">3</span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Create a tunnel</p>
                  <p className="text-xs text-muted-foreground">
                    Go to{" "}
                    <a href="https://playit.gg/account/tunnels" target="_blank" className="text-primary underline">playit.gg/account/tunnels</a>
                    {" "}and click <strong>Add Tunnel</strong>. Select <strong>Minecraft Server</strong> as the type.
                    Set the port to <strong>25565</strong> (TCP).
                  </p>
                  <Button variant="outline" size="sm" onClick={() => window.open("https://playit.gg/account/tunnels", "_blank")}>
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open Tunnels Page
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground flex-shrink-0">4</span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Link your agent</p>
                  <p className="text-xs text-muted-foreground">
                    If a claim URL appeared above, click it to link this machine to your account.
                    If no claim URL appeared, the agent is already linked.
                  </p>
                  {netState?.playitClaimUrl && (
                    <Button variant="outline" size="sm" onClick={() => window.open(netState.playitClaimUrl!, "_blank")}>
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Claim Agent
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              <div className="flex gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white flex-shrink-0">
                  <CheckCircle className="h-4 w-4" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Restart networking</p>
                  <p className="text-xs text-muted-foreground">
                    After creating the tunnel on playit.gg, toggle the Networking switch <strong>off and on again</strong>.
                    Your server address will appear here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

