import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  Loader2,
  Server,
  Search,
  Download,
  Package,
} from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toaster";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ModrinthProject {
  project_id: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url: string;
  categories: string[];
  display_categories: string[];
}

interface ModVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
}

interface ModpackFile {
  path: string;
  size: number;
  downloads: string | null;
  env: { client?: string; server?: string } | null;
}

interface ModpackContents {
  name: string;
  gameVersion: string;
  loader: string;
  files: ModpackFile[];
  fileCount: number;
}

const SORT_MODPACKS = [
  { value: "downloads", label: "Most Downloaded" },
  { value: "follows", label: "Most Followed" },
  { value: "newest", label: "Newest" },
];

const SERVER_TYPES = [
  { value: "vanilla", label: "Vanilla" },
  { value: "fabric", label: "Fabric" },
  { value: "modpack", label: "Modpack" },
];

export default function NewServer() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState<"vanilla" | "fabric" | "modpack">("vanilla");
  const [gameVersion, setGameVersion] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [ram, setRam] = useState(2048);

  // Modpack state
  const [modpackQuery, setModpackQuery] = useState("");
  const [modpackSort, setModpackSort] = useState("downloads");
  const [selectedPack, setSelectedPack] = useState<ModrinthProject | null>(null);
  const [versionDialog, setVersionDialog] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState("");

  // Preview dialog state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [modpackContents, setModpackContents] = useState<ModpackContents | null>(null);
  const [includedFiles, setIncludedFiles] = useState<Set<string>>(new Set());
  const [loadingContents, setLoadingContents] = useState(false);

  const { data: vanillaVersions, isLoading: vLoading } = useQuery<string[]>({
    queryKey: ["versions", "vanilla"],
    queryFn: async () => {
      const { data } = await api.get("/versions/vanilla");
      return data;
    },
  });

  const { data: fabricGameVersions, isLoading: fgLoading } = useQuery<string[]>({
    queryKey: ["versions", "fabric", "game"],
    queryFn: async () => {
      const { data } = await api.get("/versions/fabric/game");
      return data;
    },
    enabled: serverType === "fabric",
  });

  const { data: fabricLoaderVersions, isLoading: flLoading } = useQuery<
    Array<{ version: string; stable: boolean }>
  >({
    queryKey: ["versions", "fabric", "loader"],
    queryFn: async () => {
      const { data } = await api.get("/versions/fabric/loader");
      return data;
    },
    enabled: serverType === "fabric" || serverType === "modpack",
  });

  const { data: packResults, isLoading: packsLoading } = useQuery<{ hits: ModrinthProject[] }>({
    queryKey: ["modrinth", "modpacks", modpackQuery, modpackSort],
    queryFn: async () => {
      const { data } = await api.get("/modrinth/search", {
        params: { q: modpackQuery, sort: modpackSort, projectType: "modpack", serverSide: "true" },
      });
      return data;
    },
    enabled: serverType === "modpack",
  });

  const { data: packVersions, isLoading: versionsLoading } = useQuery<ModVersion[]>({
    queryKey: ["modrinth", "versions", selectedPack?.project_id],
    queryFn: async () => {
      if (!selectedPack) return [];
      const { data } = await api.get(`/modrinth/project/${selectedPack.project_id}/versions`);
      return data;
    },
    enabled: versionDialog && !!selectedPack,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { name, type: serverType, ram };
      if (serverType === "vanilla") payload.gameVersion = gameVersion;
      if (serverType === "fabric") {
        payload.gameVersion = gameVersion;
        payload.loaderVersion = loaderVersion;
      }
      if (serverType === "modpack") {
        payload.modpackId = selectedPack?.project_id;
        payload.modpackVersionId = selectedVersionId;
        if (loaderVersion) payload.loaderVersion = loaderVersion;
        if (includedFiles.size > 0) payload.includeFiles = Array.from(includedFiles);
      }
      const { data } = await api.post("/servers", payload);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Server created successfully" });
      navigate("/");
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || err.message;
      toast({ title: "Failed to create server", description: msg, variant: "destructive" });
    },
  });

  const canCreate =
    name.trim().length > 0 &&
    (serverType === "modpack"
      ? !!selectedPack && !!selectedVersionId
      : serverType === "fabric"
      ? !!gameVersion && !!loaderVersion
      : !!gameVersion);

  const versions = serverType === "fabric" ? fabricGameVersions : vanillaVersions;
  const versionLoading = serverType === "fabric" ? fgLoading : vLoading;

  const handlePackSelect = (pack: ModrinthProject) => {
    setSelectedPack(pack);
    setSelectedVersionId("");
    setVersionDialog(true);
  };

  const handleConfirmPack = async () => {
    if (!selectedVersionId) return;
    setVersionDialog(false);
    setPreviewOpen(true);
    try {
      const { data } = await api.get(`/modrinth/version/${selectedVersionId}/contents`);
      setModpackContents(data);
      setIncludedFiles(new Set(data.files.map((f: ModpackFile) => f.path)));
    } catch (err: any) {
      toast({ title: "Failed to load modpack preview", description: err.response?.data?.error || err.message, variant: "destructive" });
      setPreviewOpen(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">New Server</h1>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Create Minecraft Server
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Server Name</Label>
              <Input
                id="name"
                placeholder="My Server"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Server Type</Label>
              <div className="flex gap-2">
                {SERVER_TYPES.map((type) => (
                  <Button
                    key={type.value}
                    variant={serverType === type.value ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => {
                      setServerType(type.value as typeof serverType);
                      setGameVersion("");
                      setLoaderVersion("");
                      setSelectedPack(null);
                    }}
                  >
                    {type.label}
                  </Button>
                ))}
              </div>
            </div>

            {serverType !== "modpack" && (
              <>
                <div className="space-y-2">
                  <Label>Game Version</Label>
                  <Select value={gameVersion} onValueChange={setGameVersion} disabled={versionLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder={versionLoading ? "Loading..." : "Select version"} />
                    </SelectTrigger>
                    <SelectContent>
                      {versions?.map((v: any) => (
                        <SelectItem key={typeof v === "string" ? v : v.version} value={typeof v === "string" ? v : v.version}>
                          {typeof v === "string" ? v : v.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {serverType === "fabric" && (
                  <div className="space-y-2">
                    <Label>Fabric Loader Version</Label>
                    <Select value={loaderVersion} onValueChange={setLoaderVersion} disabled={flLoading}>
                      <SelectTrigger>
                        <SelectValue placeholder={flLoading ? "Loading..." : "Select loader version"} />
                      </SelectTrigger>
                      <SelectContent>
                        {fabricLoaderVersions?.map((v) => (
                          <SelectItem key={v.version} value={v.version}>
                            {v.version} {v.stable ? "" : "(unstable)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {serverType === "modpack" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Fabric Loader Version</Label>
                  <Select value={loaderVersion} onValueChange={setLoaderVersion} disabled={flLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder={flLoading ? "Loading..." : "Auto (latest stable)"} />
                    </SelectTrigger>
                    <SelectContent>
                      {fabricLoaderVersions?.map((v) => (
                        <SelectItem key={v.version} value={v.version}>
                          {v.version} {v.stable ? "" : "(unstable)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!selectedPack ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search modpacks..."
                        className="pl-9"
                        value={modpackQuery}
                        onChange={(e) => setModpackQuery(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={modpackSort} onValueChange={setModpackSort}>
                        <SelectTrigger className="h-7 w-44 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SORT_MODPACKS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {packsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                      </div>
                    ) : !packResults?.hits?.length ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        {modpackQuery ? "No modpacks found" : "Browse popular modpacks"}
                      </div>
                    ) : (
                      <div className="max-h-80 space-y-2 overflow-y-auto">
                        {packResults.hits.map((pack) => (
                          <Card key={pack.project_id} className="cursor-pointer transition-colors hover:bg-card/60" onClick={() => handlePackSelect(pack)}>
                            <CardContent className="flex gap-3 p-3">
                              {pack.icon_url && (
                                <img src={pack.icon_url} alt="" className="h-10 w-10 rounded-lg flex-shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium">{pack.title}</p>
                                  <span className="text-xs text-muted-foreground">by {pack.author}</span>
                                </div>
                                <p className="line-clamp-2 text-xs text-muted-foreground">{pack.description}</p>
                                <div className="mt-1 flex gap-1">
                                  {pack.display_categories?.slice(0, 2).map((c: string) => (
                                    <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                                  ))}
                                  <Badge variant="secondary" className="text-xs">
                                    {pack.downloads?.toLocaleString()} downloads
                                  </Badge>
                                </div>
                              </div>
                              <Download className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-2" />
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
                    {selectedPack.icon_url && (
                      <img src={selectedPack.icon_url} alt="" className="h-8 w-8 rounded-lg" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium">{selectedPack.title}</p>
                      <p className="text-xs text-muted-foreground">by {selectedPack.author}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedPack(null); setSelectedVersionId(""); }}>
                      Change
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>RAM ({ram} MB)</Label>
                <span className="text-sm text-muted-foreground">
                  {ram >= 1024 ? `${(ram / 1024).toFixed(1)} GB` : `${ram} MB`}
                </span>
              </div>
              <Slider value={[ram]} onValueChange={([v]) => setRam(v)} min={512} max={16384} step={128} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>512 MB</span>
                <span>16 GB</span>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={!canCreate || createMutation.isPending}
              onClick={() => {
                if (serverType === "modpack" && selectedPack) {
                  setVersionDialog(true);
                } else {
                  createMutation.mutate();
                }
              }}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Server"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={versionDialog} onOpenChange={setVersionDialog}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">Select {selectedPack?.title} Version</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 min-w-0 overflow-hidden">
            {versionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading versions...
              </div>
            ) : !packVersions?.length ? (
              <p className="text-sm text-destructive">No versions available</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto overflow-x-hidden">
                {packVersions.map((v) => (
                  <label
                    key={v.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors overflow-hidden ${
                      selectedVersionId === v.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="packVersion"
                      value={v.id}
                      checked={selectedVersionId === v.id}
                      onChange={() => setSelectedVersionId(v.id)}
                      className="sr-only"
                    />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="font-medium truncate">{v.version_number}</p>
                      <p className="text-xs text-muted-foreground truncate">{v.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {v.game_versions.slice(0, 5).join(", ")}
                        {v.game_versions.length > 5 ? "..." : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs flex-shrink-0 self-start mt-0.5">{v.loaders.join(", ")}</Badge>
                  </label>
                ))}
              </div>
            )}
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVersionDialog(false)}>Cancel</Button>
              <Button onClick={handleConfirmPack} disabled={!selectedVersionId}>
                <Package className="h-4 w-4 mr-1" />
                Install Modpack
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) setPreviewOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview: {modpackContents?.name || selectedPack?.title}</DialogTitle>
          </DialogHeader>
          {loadingContents ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading modpack contents...
            </div>
          ) : !modpackContents ? (
            <p className="text-sm text-destructive">Failed to load modpack</p>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Summary */}
              <div className="flex items-center gap-3 mb-3 text-sm">
                <Badge variant="outline">{modpackContents.gameVersion}</Badge>
                <Badge variant="outline">{modpackContents.loader}</Badge>
                <span className="text-muted-foreground">{modpackContents.fileCount} files</span>
                <span className="text-muted-foreground">{includedFiles.size} selected</span>
              </div>

              {/* File list grouped by folder */}
              <div className="flex-1 max-h-80 space-y-1 overflow-y-auto">
                {modpackContents.files.map((file) => {
                  const isIncluded = includedFiles.has(file.path);
                  const envServer = file.env?.server;
                  return (
                    <label
                      key={file.path}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer transition-colors ${
                        isIncluded ? "bg-primary/5 hover:bg-primary/10" : "opacity-50 hover:opacity-80"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() => {
                          const next = new Set(includedFiles);
                          if (isIncluded) next.delete(file.path);
                          else next.add(file.path);
                          setIncludedFiles(next);
                        }}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="flex-1 truncate">{file.path}</span>
                      {envServer && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1 py-0 ${
                            envServer === "required" ? "border-green-600 text-green-500" :
                            envServer === "optional" ? "border-yellow-600 text-yellow-500" :
                            "border-red-600 text-red-500"
                          }`}
                        >
                          {envServer}
                        </Badge>
                      )}
                      {file.size > 0 && (
                        <span className="text-muted-foreground flex-shrink-0">
                          {file.size >= 1048576
                            ? `${(file.size / 1048576).toFixed(1)} MB`
                            : file.size >= 1024
                            ? `${(file.size / 1024).toFixed(0)} KB`
                            : `${file.size} B`}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              <Separator className="my-3" />
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">
                  {includedFiles.size} of {modpackContents.files.length} files will be installed
                  {includedFiles.size < modpackContents.files.length && ` (${modpackContents.files.length - includedFiles.size} skipped)`}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
                  <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        Installing...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-1" />
                        Install ({includedFiles.size} files)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
