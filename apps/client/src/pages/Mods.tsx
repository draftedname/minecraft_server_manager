// MC Server GUI
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Search,
  Download,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Filter,
  ArrowUpDown,
  RefreshCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toaster";
import type { ServerConfig, ModInfo } from "@mcservergui/shared";

interface ModrinthProject {
  project_id: string;
  project_type: string;
  slug: string;
  author: string;
  title: string;
  description: string;
  categories: string[];
  display_categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string;
  client_side: string;
  server_side: string;
}

interface ModVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
}

const SORT_OPTIONS = [
  { value: "downloads", label: "Most Downloaded" },
  { value: "follows", label: "Most Followed" },
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently Updated" },
];

const CATEGORY_FILTERS = [
  "adventure", "building", "combat", "decoration", "economy",
  "equipment", "food", "game-mechanics", "library", "magic",
  "management", "optimization", "social", "storage", "technology",
  "transportation", "utility", "world-generation",
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Mods() {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [serverSideOnly, setServerSideOnly] = useState(true);
  const [sort, setSort] = useState("downloads");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Version selection state
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ModrinthProject | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");

  const { data: server } = useQuery<{ config: ServerConfig }>({
    queryKey: ["server", serverId],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}`);
      return data;
    },
    enabled: !!serverId,
  });

  const { data: mods, isLoading: modsLoading } = useQuery<ModInfo[]>({
    queryKey: ["server", serverId, "mods"],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}/mods`);
      return data;
    },
    enabled: !!serverId,
  });

  const loaderFilter = server?.config.type === "fabric" ? "fabric" : undefined;
  const gameVersion = server?.config.gameVersion;

  const { data: searchResults, isLoading: searching } = useQuery<{ hits: ModrinthProject[]; total_hits: number }>({
    queryKey: ["modrinth", "search", searchQuery, loaderFilter, gameVersion, serverSideOnly, sort, selectedCategories, page],
    queryFn: async () => {
      const params: any = {
        q: searchQuery,
        loader: loaderFilter,
        version: gameVersion,
        sort,
        offset: page * PAGE_SIZE,
      };
      if (!serverSideOnly) params.serverSide = "false";
      if (selectedCategories.length > 0) params.categories = selectedCategories.join(",");
      const { data } = await api.get("/modrinth/search", { params });
      return data;
    },
    enabled: !!server,
  });

  useEffect(() => {
    setPage(0);
  }, [searchQuery, sort, serverSideOnly, selectedCategories]);

  const { data: projectVersions, isLoading: versionsLoading } = useQuery<ModVersion[]>({
    queryKey: ["modrinth", "versions", selectedProject?.project_id, loaderFilter],
    queryFn: async () => {
      if (!selectedProject) return [];
      const params: any = {};
      if (loaderFilter) params.loader = loaderFilter;
      const { data } = await api.get(`/modrinth/project/${selectedProject.project_id}/versions`, { params });
      return data;
    },
    enabled: versionDialogOpen && !!selectedProject,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ filename }: { filename: string }) => {
      await api.put(`/servers/${serverId}/mods/${encodeURIComponent(filename)}/toggle`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "mods"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (filename: string) => {
      await api.delete(`/servers/${serverId}/mods/${encodeURIComponent(filename)}`);
    },
    onSuccess: () => {
      toast({ title: "Mod removed" });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "mods"] });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (versionId: string) => {
      await api.post(`/servers/${serverId}/mods/install`, {
        versionId,
        projectId: selectedProject?.project_id || "",
      });
    },
    onSuccess: () => {
      toast({ title: "Mod installed" });
      setVersionDialogOpen(false);
      setSelectedProject(null);
      setSelectedVersionId("");
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "mods"] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || err.message || "Install failed";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const checkUpdatesMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/servers/${serverId}/mods/check-updates`);
      return data;
    },
    onSuccess: (data: any) => {
      if (data.outdated === 0) {
        toast({ title: "All mods are up to date" });
      } else {
        toast({
          title: `${data.outdated} update(s) available`,
          description: data.updates.map((u: any) => `${u.filename}: ${u.currentVersion} -> ${u.latestVersion}`).join(", "),
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Update check failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const updateAllMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/servers/${serverId}/mods/update-all`);
      return data;
    },
    onSuccess: (data: any) => {
      toast({ title: `Updated ${data.updated} mod(s)` });
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "mods"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.response?.data?.error || err.message, variant: "destructive" });
    },
  });

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleInstallClick = (project: ModrinthProject) => {
    setSelectedProject(project);
    setSelectedVersionId("");
    setVersionDialogOpen(true);
  };

  const handleConfirmInstall = () => {
    if (!selectedVersionId) return;
    installMutation.mutate(selectedVersionId);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Package className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">Mods</h1>
          <p className="text-xs text-muted-foreground">{server?.config.name}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="installed">
          <TabsList className="mb-4">
            <TabsTrigger value="installed">Installed</TabsTrigger>
            <TabsTrigger value="browse">Browse Modrinth</TabsTrigger>
          </TabsList>

          <TabsContent value="installed">
            {modsLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : !mods || mods.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <Package className="h-8 w-8" />
                  <p>No mods installed</p>
                  <p className="text-xs">Switch to the Browse tab to find mods</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {(mods.length > 0) && (
                  <div className="flex gap-2 mb-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => checkUpdatesMutation.mutate()}
                      disabled={checkUpdatesMutation.isPending}
                    >
                      {checkUpdatesMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCcw className="h-3 w-3 mr-1" />
                      )}
                      Check for Updates
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateAllMutation.mutate()}
                      disabled={updateAllMutation.isPending}
                    >
                      {updateAllMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Download className="h-3 w-3 mr-1" />
                      )}
                      Update All
                    </Button>
                  </div>
                )}
                {mods.map((mod) => (
                  <Card key={mod.filename}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">{mod.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {mod.filename} - {formatSize(mod.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {mod.enabled ? (
                          <Badge variant="success">Enabled</Badge>
                        ) : (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggleMutation.mutate({ filename: mod.filename })}
                          title={mod.enabled ? "Disable" : "Enable"}
                        >
                          {mod.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeMutation.mutate(mod.filename)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="browse">
            <div className="mb-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search or browse mods..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Filters:</span>
                </div>

                <div className="flex items-center gap-2">
                  <Switch id="server-side" checked={serverSideOnly} onCheckedChange={setServerSideOnly} />
                  <Label htmlFor="server-side" className="cursor-pointer text-muted-foreground">
                    Server-side only
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="h-7 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {loaderFilter && <Badge variant="outline">{loaderFilter}</Badge>}
                {gameVersion && <Badge variant="outline">{gameVersion}</Badge>}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_FILTERS.map((cat) => (
                  <Badge
                    key={cat}
                    variant={selectedCategories.includes(cat) ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => toggleCategory(cat)}
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>

            {searching ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading mods...
              </div>
            ) : !searchResults?.hits?.length ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No mods found
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {searchResults.hits.map((project) => (
                  <Card key={project.project_id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex gap-4">
                        {project.icon_url && (
                          <img
                            src={project.icon_url}
                            alt={project.title}
                            className="h-12 w-12 rounded-lg flex-shrink-0"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{project.title}</p>
                            <span className="text-xs text-muted-foreground">by {project.author}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {project.description}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {project.categories?.slice(0, 2).map((cat: string) => (
                              <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                            ))}
                            {project.server_side !== "unsupported" && (
                              <Badge variant="outline" className="text-xs">
                                {project.server_side === "required" ? "Server" : "Optional"}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {project.downloads?.toLocaleString()} downloads
                            </Badge>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleInstallClick(project)}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Install
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {(searchResults?.hits?.length ?? 0) > 0 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-xs text-muted-foreground">
                  {searchResults!.total_hits ? `${searchResults!.total_hits.toLocaleString()} total` : ""}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="flex items-center text-xs text-muted-foreground px-2">
                    {page + 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(searchResults!.hits?.length ?? 0) < PAGE_SIZE}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">Install {selectedProject?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 min-w-0 overflow-hidden">
            {selectedProject && (
              <div className="flex gap-3 min-w-0">
                {selectedProject.icon_url && (
                  <img
                    src={selectedProject.icon_url}
                    alt={selectedProject.title}
                    className="h-10 w-10 rounded-lg flex-shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="text-sm text-muted-foreground line-clamp-2 break-all">
                    {selectedProject.description}
                  </p>
                </div>
              </div>
            )}
            <Separator />
            <div className="space-y-2 min-w-0">
              <Label>Select Version</Label>
              <p className="text-xs text-muted-foreground truncate">
                Server: {gameVersion}{loaderFilter ? ` / ${loaderFilter}` : ""}
              </p>
              {versionsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading versions...
                </div>
              ) : !projectVersions || projectVersions.length === 0 ? (
                <p className="text-sm text-destructive">No versions available</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto overflow-x-hidden">



                    {projectVersions.map((v) => {
                      const isCompatible = v.game_versions.includes(gameVersion || "");
                      return (
                        <label
                          key={v.id}
                          className={`flex items-center gap-2 rounded-md border p-2 text-sm transition-colors overflow-hidden ${
                            !isCompatible
                              ? "cursor-not-allowed opacity-40 border-border"
                              : selectedVersionId === v.id
                              ? "cursor-pointer border-primary bg-primary/10"
                              : "cursor-pointer border-border hover:bg-accent"
                          }`}
                        >
                          {isCompatible && (
                            <input
                              type="radio"
                              name="version"
                              value={v.id}
                              checked={selectedVersionId === v.id}
                              onChange={() => setSelectedVersionId(v.id)}
                              className="sr-only"
                            />
                          )}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="font-medium truncate">{v.version_number}</p>
                              {!isCompatible && (
                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                  Incompatible
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{v.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {v.game_versions.slice(0, 5).join(", ")}
                              {v.game_versions.length > 5 ? "..." : ""}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs flex-shrink-0 self-start mt-0.5">
                            {v.loaders.join(", ")}
                          </Badge>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setVersionDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmInstall}
                disabled={!selectedVersionId || installMutation.isPending}
              >
                {installMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Installing...
                  </>
                ) : (
                  "Install"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

