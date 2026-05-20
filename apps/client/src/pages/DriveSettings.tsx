// MC Server GUI
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Link, Unlink, Upload, Clock, Trash2, Download, Loader2, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";

interface DriveStatus {
  hasCredentials: boolean;
  authenticated: boolean;
  folderId: string | null;
}

interface DriveBackup {
  id: string;
  name: string;
  size: string;
  created: string;
}

function formatSize(bytes: string) {
  const n = parseInt(bytes);
  if (isNaN(n) || n < 1024) return `${bytes} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function DriveSettings() {
  const queryClient = useQueryClient();
  const [credentialsJson, setCredentialsJson] = useState("");

  const { data: status } = useQuery<DriveStatus>({
    queryKey: ["drive", "status"],
    queryFn: async () => {
      const { data } = await api.get("/drive/status");
      return data;
    },
  });

  const { data: schedule } = useQuery<{ enabled: boolean; intervalMinutes: number }>({
    queryKey: ["drive", "schedule"],
    queryFn: async () => {
      const { data } = await api.get("/drive/schedule");
      return data;
    },
  });

  const { data: backups } = useQuery<DriveBackup[]>({
    queryKey: ["drive", "backups"],
    queryFn: async () => {
      const { data } = await api.get("/drive/backups");
      return data;
    },
    enabled: !!status?.authenticated,
    refetchInterval: 30000,
  });

  const authMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.get("/drive/auth-url");
      window.open(data.url, "_blank");
    },
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["drive"] });
      }, 5000);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => await api.post("/drive/disconnect"),
    onSuccess: () => {
      toast({ title: "Drive disconnected" });
      queryClient.invalidateQueries({ queryKey: ["drive"] });
    },
  });

  const uploadCredsMutation = useMutation({
    mutationFn: async (json: string) => {
      await api.post("/drive/credentials", { credentials: json });
    },
    onSuccess: () => {
      toast({ title: "Credentials saved. Now connect your account." });
      queryClient.invalidateQueries({ queryKey: ["drive", "status"] });
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.error || "Invalid JSON", variant: "destructive" });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (config: { enabled: boolean; intervalMinutes: number }) => {
      await api.put("/drive/schedule", config);
    },
    onSuccess: () => {
      toast({ title: "Schedule updated" });
      queryClient.invalidateQueries({ queryKey: ["drive", "schedule"] });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <HardDrive className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">Google Drive Backup</h1>
          <p className="text-xs text-muted-foreground">Automatic world backups to your Drive</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Setup */}
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>
              1. Go to{" "}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-primary underline">
                Google Cloud Console <ExternalLink className="inline h-3 w-3" />
              </a>
              {" "}and create an OAuth 2.0 Client ID for a Desktop app. Download the JSON.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!status?.hasCredentials ? (
              <div className="space-y-3">
                <div>
                  <Label>Paste credentials JSON</Label>
                  <textarea
                    className="mt-1 flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono text-xs"
                    placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                    value={credentialsJson}
                    onChange={(e) => setCredentialsJson(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => uploadCredsMutation.mutate(credentialsJson)}
                  disabled={!credentialsJson.trim() || uploadCredsMutation.isPending}
                >
                  {uploadCredsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Save Credentials
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium">Credentials configured</p>
                  <p className="text-xs text-muted-foreground">
                    {status.authenticated ? "Connected to Google Drive" : "Not authenticated"}
                  </p>
                </div>
                {!status.authenticated ? (
                  <Button onClick={() => authMutation.mutate()}>
                    <Link className="h-4 w-4 mr-1" />
                    Connect Google Account
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => disconnectMutation.mutate()}>
                    <Unlink className="h-4 w-4 mr-1" />
                    Disconnect
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schedule */}
        {status?.authenticated && (
          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <CardDescription>Automatically backup worlds to Drive</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Switch
                  checked={schedule?.enabled || false}
                  onCheckedChange={(v) => scheduleMutation.mutate({ enabled: v, intervalMinutes: schedule?.intervalMinutes || 360 })}
                />
                <Label>Enable scheduled backups</Label>
              </div>
              {schedule?.enabled && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Interval: every {schedule.intervalMinutes} minutes</Label>
                    <span className="text-xs text-muted-foreground">
                      {schedule.intervalMinutes >= 60
                        ? `every ${(schedule.intervalMinutes / 60).toFixed(1)} hours`
                        : `every ${schedule.intervalMinutes} min`}
                    </span>
                  </div>
                  <Slider
                    value={[schedule.intervalMinutes]}
                    onValueChange={([v]) => scheduleMutation.mutate({ enabled: true, intervalMinutes: v })}
                    min={30}
                    max={1440}
                    step={30}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>30 min</span>
                    <span>24 hours</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Backups */}
        {status?.authenticated && (
          <Card>
            <CardHeader>
              <CardTitle>Drive Backups</CardTitle>
              <CardDescription>Files in "MC Server GUI Backups" folder</CardDescription>
            </CardHeader>
            <CardContent>
              {!backups?.length ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No backups on Drive yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs truncate max-w-xs">{b.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatSize(b.size)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(b.created).toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                window.open(`https://drive.google.com/file/d/${b.id}/view`, "_blank");
                              }}
                              title="Open in Drive"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                window.open(`/api/drive/backups/${b.id}/download`, "_blank");
                              }}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

