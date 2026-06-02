import { createWriteStream } from "fs";

const MODRINTH_BASE = "https://api.modrinth.com/v2";
const USER_AGENT = "mcservergui/1.0 (admin@localhost)";

interface SearchHit {
  project_id: string;
  project_type: string;
  slug: string;
  author: string;
  title: string;
  description: string;
  categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string;
  client_side: string;
  server_side: string;
}

interface SearchResult {
  hits: SearchHit[];
  total_hits: number;
  offset: number;
  limit: number;
}

interface ModProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string;
  client_side: string;
  server_side: string;
}

export interface ModVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  dependencies: Array<{
    version_id: string | null;
    project_id: string | null;
    dependency_type: "required" | "optional" | "incompatible" | "embedded";
  }>;
  files: Array<{
    url: string;
    filename: string;
    size?: number;
  }>;
}

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${MODRINTH_BASE}${path}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Modrinth API error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export async function searchMods(
  query: string,
  loader?: string,
  gameVersion?: string,
  serverSide?: boolean,
  sort?: string,
  categories?: string[],
  projectType?: string,
  offset?: number
): Promise<SearchResult> {
  const facets: string[][] = [[`project_type:${projectType || "mod"}`]];

  if (serverSide ?? true) {
    facets.push(["server_side:required", "server_side:optional"]);
  }

  if (loader) {
    facets.push([`categories:${loader}`]);
  }

  if (categories && categories.length > 0) {
    for (const cat of categories) {
      if (cat !== loader) {
        facets.push([`categories:${cat}`]);
      }
    }
  }

  if (gameVersion) {
    facets.push([`versions:${gameVersion}`]);
  }

  const facetParam = JSON.stringify(facets);
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  params.set("facets", facetParam);
  params.set("limit", "20");
  params.set("index", sort || "downloads");
  if (offset) params.set("offset", String(offset));

  const queryString = params.toString();
  return apiFetch<SearchResult>(`/search?${queryString}`);
}

export async function getProject(id: string): Promise<ModProject> {
  return apiFetch<ModProject>(`/project/${id}`);
}

export async function getProjectVersions(
  projectId: string,
  loader?: string,
  gameVersion?: string
): Promise<ModVersion[]> {
  const params = new URLSearchParams();
  if (loader) params.set("loaders", JSON.stringify([loader]));
  if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));

  const queryString = params.toString();
  const url = queryString ? `/project/${projectId}/version?${queryString}` : `/project/${projectId}/version`;
  return apiFetch<ModVersion[]>(url);
}

export async function getVersion(versionId: string): Promise<ModVersion> {
  return apiFetch<ModVersion>(`/version/${versionId}`);
}

export async function getLatestCompatibleVersion(
  projectId: string,
  gameVersion: string,
  loader?: string
): Promise<ModVersion | null> {
  const versions = await getProjectVersions(projectId, loader, gameVersion);

  if (!versions || versions.length === 0) return null;

  const compatible = versions.filter(
    (v) =>
      v.game_versions.includes(gameVersion) &&
      (!loader || v.loaders.includes(loader))
  );

  if (compatible.length === 0) return null;

  return compatible[0];
}

export async function resolveDependencies(
  versionId: string,
  gameVersion: string,
  loader: string,
  depth: number = 0
): Promise<{ versions: ModVersion[]; projects: ModProject[] }> {
  if (depth > 5) return { versions: [], projects: [] };

  const version = await getVersion(versionId);
  const versions: ModVersion[] = [version];
  const projects: ModProject[] = [];
  const seenProjectIds = new Set<string>();

  if (!version.dependencies) return { versions, projects };

  for (const dep of version.dependencies) {
    if (dep.dependency_type !== "required") continue;
    if (!dep.project_id) continue;
    if (seenProjectIds.has(dep.project_id)) continue;
    seenProjectIds.add(dep.project_id);

    const depVersion = await getLatestCompatibleVersion(
      dep.project_id,
      gameVersion,
      loader
    );

    if (!depVersion) continue;

    try {
      const depDetails = await getProject(dep.project_id);
      projects.push(depDetails);
    } catch {
      // project lookup failed, skip
    }

    const resolved = await resolveDependencies(
      depVersion.id,
      gameVersion,
      loader,
      depth + 1
    );

    for (const v of resolved.versions) {
      if (!versions.find((existing) => existing.id === v.id)) {
        versions.push(v);
      }
    }
    for (const p of resolved.projects) {
      if (!projects.find((existing) => existing.id === p.id)) {
        projects.push(p);
      }
    }
  }

  return { versions, projects };
}

export async function downloadModFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const writer = createWriteStream(dest);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
    }
    await new Promise<void>((resolve, reject) => {
      writer.end(resolve);
      writer.on("error", reject);
    });
  } catch (err) {
    writer.destroy();
    throw err;
  }
}
