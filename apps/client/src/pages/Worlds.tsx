import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  Archive,
  Trash2,
  Download,
  Loader2,
  HardDrive,
  CloudUpload,
  ExternalLink,
  RotateCcw,
  Upload,
  ArrowRight,
} from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { useChunkedUpload } from "@/hooks/useChunkedUpload";
import type { ServerConfig, ServerInfo, WorldInfo, BackupMeta } from "@mcservergui/shared";


function formatSize(bytes: number | string) {
  const n = typeof bytes === "string" ? parseInt(bytes) : bytes;
  if (isNaN(n)) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function Worlds() {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();

  const { data: serverData } = useQuery<ServerInfo>({
    queryKey: ["server", serverId],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}`);
      return data;
    },
    enabled: !!serverId,
  });

  const server = serverData?.config;
  const isRunning = serverData?.status === "running";

  const { data: driveStatus } = useQuery<{ authenticated: boolean }>({
    queryKey: ["drive", "status"],
    queryFn: async () => {
      const { data } = await api.get("/drive/status");
      return data;
    },
  });

  const { data: worlds, isLoading: worldsLoading } = useQuery<WorldInfo[]>({
    queryKey: ["server", serverId, "worlds"],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}/worlds`);
      return data;
    },
    enabled: !!serverId,
    refetchInterval: 10000,
  });

  const { data: backups, isLoading: backupsLoading } = useQuery<BackupMeta[]>({
    queryKey: ["server", serverId, "backups"],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}/backups`);
      return data;
    },
    enabled: !!serverId,
    refetchInterval: 10000,
  });

  const { data: driveBackups, isLoading: driveBackupsLoading } = useQuery<
    Array<{ id: string; name: string; size: string; created: string }>
  >({
    queryKey: ["drive", "backups", server?.name],
    queryFn: async () => {
      const { data } = await api.get("/drive/backups", {
        params: { serverName: server?.name },
      });
      return data;
    },
    enabled: !!server?.name && !!driveStatus?.authenticated,
    refetchInterval: 30000,
  });

  const backupMutation = useMutation({
    mutationFn: async (worldName: string) => {
      await api.post(`/servers/${serverId}/worlds/backup`, { worldName });
    },
    onSuccess: () => {
      toast({ title: "Backup created" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "backups"] });
    },
    onError: (err: any) => {
      toast({
        title: "Backup failed",
        description: err.response?.data?.error || err.message,
        variant: "destructive",
      });
    },
  });

  const driveBackupMutation = useMutation({
    mutationFn: async (worldName: string) => {
      await api.post("/drive/backup", { serverId, worldName });
    },
    onSuccess: () => {
      toast({ title: "Backup uploaded to Drive" });
      queryClient.invalidateQueries({ queryKey: ["drive", "backups", server?.name] });
    },
    onError: (err: any) => {
      toast({
        title: "Drive backup failed",
        description: err.response?.data?.error || err.message,
        variant: "destructive",
      });
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (backupId: string) => {
      await api.delete(`/servers/${serverId}/backups/${backupId}`);
    },
    onSuccess: () => {
      toast({ title: "Backup deleted" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "backups"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ backupId, worldName }: { backupId: string; worldName: string }) => {
      await api.post(`/servers/${serverId}/worlds/restore`, { backupId, worldName });
    },
    onSuccess: (_, vars) => {
      toast({ title: `World "${vars.worldName}" restored` });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "worlds"] });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "backups"] });
    },
    onError: (err: any) => {
      toast({ title: "Restore failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const restoreDriveMutation = useMutation({
    mutationFn: async ({ driveFileId, worldName }: { driveFileId: string; worldName: string }) => {
      await api.post(`/servers/${serverId}/worlds/restore-drive`, { driveFileId, worldName });
    },
    onSuccess: (_, vars) => {
      toast({ title: `World "${vars.worldName}" restored from Drive` });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "worlds"] });
    },
    onError: (err: any) => {
      toast({ title: "Restore failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const deleteDriveMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await api.delete(`/drive/backups/${fileId}`);
    },
    onSuccess: () => {
      toast({ title: "Deleted from Drive" });
      queryClient.invalidateQueries({ queryKey: ["drive", "backups", server?.name] });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const activateWorldMutation = useMutation({
    mutationFn: async (worldName: string) => {
      await api.put(`/servers/${serverId}/worlds/${encodeURIComponent(worldName)}/activate`);
    },
    onSuccess: () => {
      toast({ title: "World activated" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "worlds"] });
    },
    onError: (err: any) => {
      toast({ title: "Activation failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const extractWorldFromFilename = (filename: string): string => {
    const match = filename.match(/^.+?-(.+?)-\d{4}-\d{2}-\d{2}T/);
    return match ? match[1] : "world";
  };

  const handleDownloadBackup = (backupId: string) => {
    window.open(`/api/servers/${serverId}/backups/${backupId}/download`, "_blank");
  };

  // World upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploading: isUploading, progress: uploadProgress, error: uploadError, upload, cancel } = useChunkedUpload();

  const uploadWorld = async (file: File) => {
    const ok = await upload(file, "", async (zipPath: string) => {
      try {
        const { data: importData } = await api.post(`/servers/${serverId}/worlds/import`, { zipPath });

        if (importData.warnings?.length > 0) {
          toast({
            title: "World imported with warnings",
            description: importData.warnings[0],
            variant: "default",
          });
        } else {
          toast({ title: "World imported" });
        }
        queryClient.invalidateQueries({ queryKey: ["server", serverId, "worlds"] });
        queryClient.invalidateQueries({ queryKey: ["server", serverId, "properties"] });
      } catch (err: any) {
        const status = err.response?.status;
        const msg = err.response?.data?.error || err.message;
        if (status === 400 && msg?.toLowerCase().includes("running")) {
          toast({ title: "Stop the server before importing a world", variant: "destructive" });
        } else {
          toast({ title: "Import failed", description: msg, variant: "destructive" });
        }
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });

    if (!ok) {
      if (uploadError) toast({ title: "Upload failed", description: uploadError, variant: "destructive" });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadWorld(file);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Globe className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">Worlds</h1>
          <p className="text-xs text-muted-foreground">{server?.name}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase">Worlds</h2>
            <span title={isRunning ? "Stop the server first" : ""}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isRunning}
              >
                {isUploading ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Upload className="h-3 w-3 mr-1" />
                )}
                Upload World
              </Button>
            </span>
          </div>
          {worldsLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !worlds || worlds.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Globe className="h-8 w-8" />
                <p>No worlds found</p>
                <p className="text-xs">Start the server to generate a world, or upload one</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {worlds.map((world) => (
                <Card key={world.name} className={!world.isActive ? "opacity-60" : ""}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Globe className={`h-5 w-5 ${world.isActive ? "text-green-400" : "text-muted-foreground"}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{world.name}</p>
                          {world.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Dormant</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(world.size)} - Last modified: {formatDate(world.lastModified)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {!world.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => activateWorldMutation.mutate(world.name)}
                          disabled={activateWorldMutation.isPending}
                        >
                          <ArrowRight className="h-3 w-3 mr-1" />
                          Activate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => backupMutation.mutate(world.name)}
                        disabled={backupMutation.isPending}
                      >
                      {backupMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Archive className="h-3 w-3 mr-1" />
                      )}
                      Local
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => driveBackupMutation.mutate(world.name)}
                      disabled={driveBackupMutation.isPending}
                    >
                      {driveBackupMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CloudUpload className="h-3 w-3 mr-1" />
                      )}
                      Drive
                    </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Backups</h2>
          {backupsLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !backups || backups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Archive className="h-8 w-8" />
                <p>No backups yet</p>
                <p className="text-xs">Create a backup from a world above</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {backups.map((backup) => (
                <Card key={backup.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Archive className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">
                          {backup.worldName} Backup
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(backup.size)} - {formatDate(backup.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => restoreMutation.mutate({ backupId: backup.id, worldName: backup.worldName })}
                        disabled={restoreMutation.isPending}
                        title="Restore"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownloadBackup(backup.id)}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteBackupMutation.mutate(backup.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {driveStatus?.authenticated && (
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase">
              <HardDrive className="h-4 w-4" />
              Drive Backups
            </h2>
            {driveBackupsLoading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : !driveBackups || driveBackups.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <HardDrive className="h-8 w-8" />
                  <p>No Drive backups for this server</p>
                  <p className="text-xs">Use the Drive button above to upload</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {driveBackups.map((b) => (
                  <Card key={b.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <HardDrive className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-sm">{b.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatSize(b.size)} - {new Date(b.created).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => restoreDriveMutation.mutate({ driveFileId: b.id, worldName: extractWorldFromFilename(b.name) })}
                          disabled={restoreDriveMutation.isPending}
                          title="Restore from Drive"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => window.open(`https://drive.google.com/file/d/${b.id}/view`, "_blank")}
                          title="Open in Drive"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => window.open(`/api/drive/backups/${b.id}/download`, "_blank")}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => deleteDriveMutation.mutate(b.id)}
                          title="Delete from Drive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
          )}

          {isUploading && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Uploading world...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} />
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
