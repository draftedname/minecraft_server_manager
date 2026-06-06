import { createRequire } from "module";

const _require = createRequire(import.meta.url);

export const CLIENT_ONLY_PROJECTS = new Set<string>([
  "sodium",
  "iris",
  "indium",
  "sodium-extra",
  "reeses-sodium-options",
  "continuity",
  "lambdabettergrass",
  "lambdynamiclights",
  "colormatic",
  "fabricskyboxes",
  "xaeros_minimap",
  "xaeros_worldmap",
  "voxelmap",
  "journeymap",
  "jei",
  "rei",
  "roughly-enough-items",
  "emi",
  "litematica",
  "minihud",
  "tweakeroo",
  "malilib",
  "modmenu",
  "betterf3",
  "craftingtweaks",
  "inventoryprofilesnext",
  "appleskin",
  "wthit",
  "jade",
  "hwyla",
  "what-the-hell-is-that",
  "betteradvancements",
  "advancementinfo",
  "status-effect-bars",
  "fpsdisplay",
  "entityculling",
  "cullleaves",
  "cull-less-leaves",
  "immediatelyfast",
  "smoothboot",
  "notenoughanimations",
  "first-person-model",
  "shoulder-surfing",
  "waveycapes",
  "effective",
  "particlerain",
  "shulkerboxtooltip",
  "presencefootsteps",
  "dynamiclights",
  "soundphysicsremastered",
  "nocubes",
  "worldspecificgamerules",
  "contaminated",
  "dark-loading-screen",
  "load-my-f-ing-tags",
  "clear-despawn",
  "item-highlight",
  "status-effect-timer",
  "autoregl",
  "entity-model-features",
  "entity-texture-features",
  "exordium",
  "farsight",
  "fps-reducer",
  "hold-that-chunk",
  "item-model-fix",
  "logical-zoom",
  "moreculling",
  "no-fog",
  "no-telemetry",
  "screenshot-viewer",
  "smooth-scrolling-everywhere",
  "tooltipfix",
  "voidfog",
  "spyglass-zoom",
  "zoomify",
  "ok-zoomer",
  "itemscroller",
  "tweakermore",
  "litematica-printer",
  "minihud-fabric",
  "cem",
  "capes",
  "customskinloader",
  "keystrokes",
  "dashloader",
  "fabric-seasons",
  "physicsmod",
  "distant-horizons",
  "debugify",
  "dynamic-fps",
  "eating-animation",
  "autotool",
  "autoswitch",
  "fancymenu",
  "forge-config-screens",
  "forgeconfig",
  "forge-config",
  "configured",
  "catalogue",
  "better-mod-button",
  "custom-window-title",
  "better-mods-button",
  "kiwi",
  "cloth-config",
  "cloth-config2",
  "yacl",
  "yet-another-config-lib",
  "durabilityviewer",
  "forgetorique",
  "advancement-plaques",
  "toast-control",
  "toastcontrol",
  "chat-heads",
  "chatheads",
  "chat-patches",
  "chatpatches",
  "textrues-embeddium-options",
  "textrues-rubidium-options",
  "puzzles",
  "puzzleslib",
  "iceberg",
  "prism",
  "searchlight",
  "hitassist",
  "hitmarker",
  "damagetint",
  "healing-campfire",
  "torch-hit",
  "drippy-loading-screen",
  "splasher",
  "main-menu-credits",
  "title-changer",
  "brand-emblazoner",
  "bobby",
  "bobby-reforged",
  "entityculling-forge",
  "entityculling-fabric",
  "better-beds",
  "lightsabers",
  "vivecraft",
  "occlusion-culling",
  "fullbright",
  "full-brightness-toggle",
  "mouse-tweaks",
  "mousetweaks",
  "inventory-tweaks",
  "invtweaks",
  "controllify",
  "controllable",
  "midnightcontrols",
  "midnight-controls",
  "midnightlib",
  "falling-leaves",
  "fallingleaves",
  "falling-tree",
  "fallingtree",
  "visuality",
  "carry-on",
  "carryon",
  "create-bells-and-whistles",
  "create-dreams-and-desires",
  "leaves-be-gone",
  "fog-looks-good-now",
  "fog-looks-modern",
  "smooth-swapping",
  "loads-of-lanterns",
  "cave-dust",
  "mo-glowstone",
  "iris-flywheel-compat",
  "oculus-flywheel-compat",
  "languagereload",
  "language-reload",
  "resourceloader",
  "better-ping-display",
  "betterpingdisplay",
  "packetfixer",
]);

export function checkFabricJarEnvironment(
  jarPath: string
): Promise<"client" | "server" | "both" | null> {
  return new Promise((resolve) => {
    try {
      const yauzl = _require("yauzl");

      yauzl.open(jarPath, { lazyEntries: true }, (err: Error | null, zipfile: any) => {
        if (err || !zipfile) {
          resolve(null);
          return;
        }

        let resolved = false;

        function done(val: "client" | "server" | "both" | null) {
          if (!resolved) {
            resolved = true;
            try {
              zipfile.close();
            } catch {}
            resolve(val);
          }
        }

        zipfile.on("entry", (entry: any) => {
          const name: string = entry.fileName;
          if (name === "fabric.mod.json") {
            zipfile.openReadStream(entry, (err2: Error | null, readStream: any) => {
              if (err2 || !readStream) {
                done(null);
                return;
              }

              const chunks: Buffer[] = [];
              readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
              readStream.on("end", () => {
                try {
                  const content = Buffer.concat(chunks).toString("utf-8");
                  const json = JSON.parse(content);
                  const env = json.environment;
                  if (env === "client" || env === "server" || env === "both") {
                    done(env);
                  } else {
                    done(null);
                  }
                } catch {
                  done(null);
                }
              });
              readStream.on("error", () => done(null));
            });
          } else if (name === "META-INF/mods.toml" || name === "META-INF/neoforge.mods.toml") {
            zipfile.openReadStream(entry, (err2: Error | null, readStream: any) => {
              if (err2 || !readStream) {
                done(null);
                return;
              }

              const chunks: Buffer[] = [];
              readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
              readStream.on("end", () => {
                try {
                  const content = Buffer.concat(chunks).toString("utf-8");
                  // TOML: side = "CLIENT" / "SERVER" / "BOTH"
                  const sideMatch = content.match(/^\s*side\s*=\s*"(\w+)"/m);
                  if (sideMatch) {
                    const side = sideMatch[1].toLowerCase();
                    if (side === "client" || side === "server" || side === "both") {
                      done(side as "client" | "server" | "both");
                      return;
                    }
                  }
                  done(null);
                } catch {
                  done(null);
                }
              });
              readStream.on("error", () => done(null));
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on("end", () => done(null));
        zipfile.readEntry();
      });
    } catch {
      resolve(null);
    }
  });
}
