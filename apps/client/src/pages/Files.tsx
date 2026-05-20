import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  File,
  Trash2,
  Download,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Upload,
  Loader2,
  Globe,
} from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useChunkedUpload } from "@/hooks/useChunkedUpload";
import { toast } from "@/components/ui/toaster";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function Files() {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploading, progress, error, upload } = useChunkedUpload();

  const importWorldMutation = useMutation({
    mutationFn: async (zipPath: string) => {
      await api.post(`/servers/${serverId}/worlds/import`, { zipPath });
    },
    onSuccess: () => {
      toast({ title: "World imported successfully" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "worlds"] });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const { data: files, isLoading } = useQuery<FileEntry[]>({
    queryKey: ["server", serverId, "files", currentPath],
    queryFn: async () => {
      const params: any = {};
      if (currentPath) params.relpath = currentPath;
      const { data } = await api.get(`/servers/${serverId}/files`, { params });
      return data;
    },
    enabled: !!serverId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (relpath: string) => {
      await api.delete(`/servers/${serverId}/files`, { data: { relpath } });
    },
    onSuccess: () => {
      toast({ title: "Deleted" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "files", currentPath] });
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err.response?.data?.error || err.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = (entry: FileEntry) => {
    const msg = entry.type === "directory"
      ? `Delete directory "${entry.name}" and all its contents?`
      : `Delete "${entry.name}"?`;
    if (!window.confirm(msg)) return;
    deleteMutation.mutate(entry.path);
  };

  const handleDownload = (entry: FileEntry) => {
    window.open(`/api/servers/${serverId}/files/download?relpath=${encodeURIComponent(entry.path)}`, "_blank");
  };

  const navigateTo = (dir: FileEntry) => {
    setCurrentPath(dir.path);
  };

  const breadcrumbs = currentPath ? currentPath.split("\\").filter(Boolean) : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <FolderOpen className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">Files</h1>
          <p className="text-xs text-muted-foreground">Server directory browser</p>
        </div>
        <div className="flex items-center gap-2">
          {uploading && (
            <div className="hidden sm:flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const dest = currentPath || "";
              const ok = await upload(file, dest, () => {
                toast({ title: `Uploaded ${file.name}` });
                queryClient.invalidateQueries({ queryKey: ["server", serverId, "files", currentPath] });
              });
              if (e.target) e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Upload
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {uploading && (
          <div className="mb-4 space-y-1">
            <p className="text-xs text-muted-foreground">Uploading... {progress}%</p>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
        <div className="mb-4 flex items-center gap-1 text-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPath("")}
            className="text-muted-foreground"
          >
            <HardDrive className="h-4 w-4 mr-1" />
            root
          </Button>
          {breadcrumbs.map((crumb, idx) => {
            const fullPath = breadcrumbs.slice(0, idx + 1).join("\\");
            return (
              <span key={fullPath} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentPath(fullPath)}
                  className="text-muted-foreground"
                >
                  {crumb}
                </Button>
              </span>
            );
          })}
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : !files || files.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Folder className="h-8 w-8" />
              <p>This folder is empty</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Modified</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((entry) => (
                    <TableRow key={entry.path}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {entry.type === "directory" ? (
                            <button
                              onClick={() => navigateTo(entry)}
                              className="flex items-center gap-2 text-primary hover:underline"
                            >
                              <Folder className="h-4 w-4" />
                              {entry.name}
                            </button>
                          ) : (
                            <>
                              <File className="h-4 w-4 text-muted-foreground" />
                              <span className="font-mono text-xs">{entry.name}</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.type === "directory" ? "--" : formatSize(entry.size)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(entry.modified)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {entry.type === "file" && entry.name.endsWith(".zip") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => importWorldMutation.mutate(entry.path)}
                              disabled={importWorldMutation.isPending}
                              title="Import as World"
                            >
                              <Globe className="h-4 w-4" />
                            </Button>
                          )}
                          {entry.type === "file" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDownload(entry)}
                              title="Download"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(entry)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
