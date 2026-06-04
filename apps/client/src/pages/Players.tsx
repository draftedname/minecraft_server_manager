import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Trash2, Shield, ShieldOff, Ban, UserX, Activity } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import type { PlayerEntry } from "@mcservergui/shared";

interface PlayerLists {
  online: string[];
  whitelist: PlayerEntry[];
  ops: PlayerEntry[];
  bannedPlayers: PlayerEntry[];
  bannedIps: PlayerEntry[];
}

export default function Players() {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();

  const [newWhitelist, setNewWhitelist] = useState({ name: "", uuid: "" });
  const [newOp, setNewOp] = useState({ name: "", uuid: "" });

  const { data, isLoading, refetch } = useQuery<PlayerLists>({
    queryKey: ["server", serverId, "players"],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}/players`);
      return data;
    },
    enabled: !!serverId,
    refetchInterval: 5000,
  });

  const whitelistMutation = useMutation({
    mutationFn: async (entries: PlayerEntry[]) => {
      await api.put(`/servers/${serverId}/players/whitelist`, { entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "players"] });
      toast({ title: "Whitelist updated" });
    },
  });

  const opsMutation = useMutation({
    mutationFn: async (entries: PlayerEntry[]) => {
      await api.put(`/servers/${serverId}/players/ops`, { entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "players"] });
      toast({ title: "Ops list updated" });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ name, action }: { name: string; action: string }) => {
      await api.post(`/servers/${serverId}/players/${encodeURIComponent(name)}/${action}`);
    },
    onSuccess: (_, vars) => {
      const pastTense: Record<string, string> = { kick: "kicked", ban: "banned", op: "opped", deop: "deopped" };
      toast({ title: `${vars.name} ${pastTense[vars.action] || vars.action}` });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.error || "Action failed", variant: "destructive" });
    },
  });

  const addToWhitelist = () => {
    if (!newWhitelist.name.trim()) return;
    const entries = [...(data?.whitelist || [])];
    const exists = entries.find((e) => e.uuid === newWhitelist.uuid || e.name === newWhitelist.name);
    if (exists) return;
    entries.push({ uuid: newWhitelist.uuid || crypto.randomUUID(), name: newWhitelist.name.trim() });
    whitelistMutation.mutate(entries);
    setNewWhitelist({ name: "", uuid: "" });
  };

  const addToOps = () => {
    if (!newOp.name.trim()) return;
    const entries = [...(data?.ops || [])];
    const exists = entries.find((e) => e.uuid === newOp.uuid || e.name === newOp.name);
    if (exists) return;
    entries.push({ uuid: newOp.uuid || crypto.randomUUID(), name: newOp.name.trim() });
    opsMutation.mutate(entries);
    setNewOp({ name: "", uuid: "" });
  };

  const removeFromList = (list: "whitelist" | "ops", entry: PlayerEntry) => {
    if (list === "whitelist") {
      const entries = (data?.whitelist || []).filter((e) => e.uuid !== entry.uuid);
      whitelistMutation.mutate(entries);
    } else {
      const entries = (data?.ops || []).filter((e) => e.uuid !== entry.uuid);
      opsMutation.mutate(entries);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  const online = data?.online || [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Users className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">Players</h1>
          <p className="text-xs text-muted-foreground">
            {online.length > 0 ? `${online.length} online` : "No players online"}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {online.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase">
              <Activity className="h-4 w-4 text-green-400" />
              Online Players
            </h2>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="w-48">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {online.map((name) => (
                      <TableRow key={name}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-green-400" />
                            <span className="font-medium">{name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {(() => {
                              const isOp = data?.ops?.some((o) => o.name === name);
                              return (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => actionMutation.mutate({ name, action: isOp ? "deop" : "op" })}
                              title={isOp ? "Remove Operator" : "Make Operator"}
                              disabled={actionMutation.isPending}
                            >
                                  {isOp ? (
                                    <ShieldOff className="h-3 w-3 mr-1" />
                                  ) : (
                                    <Shield className="h-3 w-3 mr-1" />
                                  )}
                                  {isOp ? "Deop" : "Op"}
                                </Button>
                              );
                            })()}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => actionMutation.mutate({ name, action: "kick" })}
                              title="Kick"
                              disabled={actionMutation.isPending}
                            >
                              <UserX className="h-3 w-3 mr-1" />
                              Kick
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => actionMutation.mutate({ name, action: "ban" })}
                              title="Ban"
                              disabled={actionMutation.isPending}
                            >
                              <Ban className="h-3 w-3 mr-1" />
                              Ban
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs defaultValue="whitelist">
          <TabsList className="mb-4">
            <TabsTrigger value="whitelist">Whitelist</TabsTrigger>
            <TabsTrigger value="ops">Operators</TabsTrigger>
            <TabsTrigger value="bans">Bans</TabsTrigger>
          </TabsList>

          <TabsContent value="whitelist">
            <Card>
              <CardHeader><CardTitle>Whitelist</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-4 flex gap-3">
                  <div className="flex-1">
                    <Label htmlFor="wl-name">Player Name</Label>
                    <Input id="wl-name" placeholder="Notch" value={newWhitelist.name} onChange={(e) => setNewWhitelist((p) => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="wl-uuid">UUID</Label>
                    <Input id="wl-uuid" placeholder="Optional" value={newWhitelist.uuid} onChange={(e) => setNewWhitelist((p) => ({ ...p, uuid: e.target.value }))} />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addToWhitelist} disabled={whitelistMutation.isPending}><Plus className="h-4 w-4" /> Add</Button>
                  </div>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>UUID</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {!data?.whitelist?.length ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No whitelisted players</TableCell></TableRow>
                    ) : (
                      data.whitelist.map((e) => (
                        <TableRow key={e.uuid || e.name}>
                          <TableCell className="font-medium">{e.name}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.uuid}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeFromList("whitelist", e)} disabled={whitelistMutation.isPending}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ops">
            <Card>
              <CardHeader><CardTitle>Operators</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-4 flex gap-3">
                  <div className="flex-1">
                    <Label htmlFor="op-name">Player Name</Label>
                    <Input id="op-name" placeholder="Notch" value={newOp.name} onChange={(e) => setNewOp((p) => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="op-uuid">UUID</Label>
                    <Input id="op-uuid" placeholder="Optional" value={newOp.uuid} onChange={(e) => setNewOp((p) => ({ ...p, uuid: e.target.value }))} />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addToOps} disabled={opsMutation.isPending}><Plus className="h-4 w-4" /> Add</Button>
                  </div>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>UUID</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {!data?.ops?.length ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No operators</TableCell></TableRow>
                    ) : (
                      data.ops.map((e) => (
                        <TableRow key={e.uuid || e.name}>
                          <TableCell className="font-medium">{e.name}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.uuid}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeFromList("ops", e)} disabled={opsMutation.isPending}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bans">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Banned Players</CardTitle>
                </CardHeader>
                <CardContent>
                  {!data?.bannedPlayers?.length ? (
                    <p className="text-sm text-muted-foreground">No banned players</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead className="w-16"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.bannedPlayers.map((p) => (
                          <TableRow key={p.uuid || p.name}>
                            <TableCell>{p.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{p.uuid}</TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" onClick={() => actionMutation.mutate({ name: p.name, action: "unban" })} disabled={actionMutation.isPending} title="Unban">
                                <UserX className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Banned IPs</CardTitle>
                </CardHeader>
                <CardContent>
                  {!data?.bannedIps?.length ? (
                    <p className="text-sm text-muted-foreground">No banned IPs</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>IP</TableHead>
                          <TableHead>UUID</TableHead>
                          <TableHead className="w-16"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.bannedIps.map((p) => (
                          <TableRow key={p.name}>
                            <TableCell className="font-mono">{p.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{p.uuid}</TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" onClick={() => actionMutation.mutate({ name: p.name, action: "unban-ip" })} disabled={actionMutation.isPending} title="Unban IP">
                                <UserX className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
