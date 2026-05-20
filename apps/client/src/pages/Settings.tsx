// MC Server GUI
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Save, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import type { ServerConfig } from "@mcservergui/shared";

interface PropertyDef {
  type: string;
  description: string;
  category: string;
  options?: string[];
}

interface PropertyCategory {
  key: string;
  label: string;
}

export default function SettingsPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();
  const [localProps, setLocalProps] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery<{
    properties: Record<string, string>;
    definitions: Record<string, PropertyDef>;
    categories: PropertyCategory[];
  }>({
    queryKey: ["server", serverId, "properties"],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}/properties`);
      return data;
    },
    enabled: !!serverId,
  });

  useEffect(() => {
    if (data?.properties) {
      setLocalProps({ ...data.properties });
      setDirty(false);
    }
  }, [data?.properties]);

  const { data: server } = useQuery<{ config: ServerConfig }>({
    queryKey: ["server", serverId],
    queryFn: async () => {
      const { data } = await api.get(`/servers/${serverId}`);
      return data;
    },
    enabled: !!serverId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/servers/${serverId}/properties`, { properties: localProps });
    },
    onSuccess: () => {
      toast({ title: "Properties saved" });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["server", serverId, "properties"] });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save",
        description: err.response?.data?.error || err.message,
        variant: "destructive",
      });
    },
  });

  const updateProp = (key: string, value: string) => {
    setLocalProps((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  if (isLoading) {
    return (
      <div className="p-8 text-muted-foreground">Loading properties...</div>
    );
  }

  if (!data) return null;

  const { definitions, categories } = data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold">Server Settings</h1>
            <p className="text-xs text-muted-foreground">{server?.config.name}</p>
          </div>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue={categories[0]?.key} className="w-full">
          <TabsList className="mb-4">
            {categories.map((cat) => (
              <TabsTrigger key={cat.key} value={cat.key}>
                {cat.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((cat) => {
            const propsInCategory = Object.entries(definitions)
              .filter(([, def]) => def.category === cat.key)
              .sort(([a], [b]) => a.localeCompare(b));

            return (
              <TabsContent key={cat.key} value={cat.key}>
                <Card>
                  <CardHeader>
                    <CardTitle>{cat.label} Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {propsInCategory.map(([key, def]) => (
                      <div key={key} className="flex items-start gap-4">
                        <div className="flex-1 space-y-1">
                          <Label htmlFor={`prop-${key}`}>{key}</Label>
                          <p className="text-xs text-muted-foreground">{def.description}</p>
                        </div>
                        <div className="w-48">
                          {def.type === "boolean" ? (
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <span className="text-sm text-muted-foreground">
                                {localProps[key] === "true" ? "On" : "Off"}
                              </span>
                              <Switch
                                id={`prop-${key}`}
                                checked={localProps[key] === "true"}
                                onCheckedChange={(v) => updateProp(key, v ? "true" : "false")}
                              />
                            </div>
                          ) : def.type === "select" && def.options ? (
                            <Select
                              value={localProps[key] || ""}
                              onValueChange={(v) => updateProp(key, v)}
                            >
                              <SelectTrigger id={`prop-${key}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {def.options.map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : def.type === "number" ? (
                            <Input
                              id={`prop-${key}`}
                              type="number"
                              value={localProps[key] || "0"}
                              onChange={(e) => updateProp(key, e.target.value)}
                            />
                          ) : (
                            <Input
                              id={`prop-${key}`}
                              value={localProps[key] || ""}
                              onChange={(e) => updateProp(key, e.target.value)}
                              placeholder=""
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </div>
  );
}

