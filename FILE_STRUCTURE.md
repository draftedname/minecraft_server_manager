# MC Server GUI — File Structure

```
mcservergui/
│
├── data/                                      # Runtime data (gitignored)
│   ├── backups/                               # Local world backup zips
│   │   └── {serverId}/
│   │       └── {backupId}.zip
│   ├── credentials/
│   │   ├── google-credentials.json            # GCP OAuth credentials
│   │   ├── drive-token.json                   # OAuth tokens (refresh + access)
│   │   └── drive-config.json                  # Cached Drive folder ID
│   ├── java/
│   │   └── jdk-{version}/                     # Auto-downloaded JDK
│   ├── playit/
│   │   └── playit.exe                         # playit.gg tunnel binary
│   ├── servers/                               # One folder per Minecraft server
│   │   └── {slug-name}/
│   │       ├── server.jar                     # Minecraft server jar
│   │       ├── server.properties              # Minecraft config
│   │       ├── eula.txt
│   │       ├── fabric-profile.json            # Classpath + mainClass for Fabric
│   │       ├── mods/
│   │       │   ├── {mod}.jar
│   │       │   ├── {mod}.jar.disabled
│   │       │   └── mods-metadata.json         # { filename: { projectId, versionId, ... } }
│   │       ├── logs/
│   │       │   └── latest.log
│   │       ├── worlds/
│   │       │   └── {world-name}/
│   │       ├── libraries/                     # Fabric dependency jars
│   │       └── level.dat
│   └── servers.json                           # Server config registry
│
├── apps/
│   ├── server/                                # Backend — Node.js + Express 5 + socket.io
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                       # Entry: Express app, route mounting, socket.io init
│   │       ├── routes/
│   │       │   ├── servers.ts                 # Server CRUD + start/stop/restart/command + console-history
│   │       │   ├── versions.ts                # Vanilla + Fabric version listings
│   │       │   ├── mods.ts                    # Mod install/remove/toggle + check-updates + update-all
│   │       │   ├── modrinth.ts                # Proxy to Modrinth API search/project/versions/latest
│   │       │   ├── modpacks.ts                # Modpack install (.mrpack extraction + mod download)
│   │       │   ├── worlds.ts                  # World list + local backup/restore/download/delete
│   │       │   ├── players.ts                 # Player lists (online/whitelist/ops/bans) + kick/ban/op/deop
│   │       │   ├── files.ts                   # File browser (list/delete/download)
│   │       │   ├── settings.ts                # Server.properties CRUD (categorized with definitions)
│   │       │   ├── java.ts                    # Java detection + JDK download
│   │       │   ├── drive.ts                   # Google Drive: auth URL, callback, disconnect, schedule, upload
│   │       │   └── network.ts                 # playit.gg: enable/disable tunnel, status, claim URL
│   │       ├── services/
│   │       │   ├── config.ts                  # Path constants for data directories
│   │       │   ├── DataStore.ts               # JSON read/write for servers.json + directory setup
│   │       │   ├── ServerManager.ts           # Process lifecycle (spawn/kill) + console capture + player tracking
│   │       │   ├── ServerJarDownloader.ts     # Vanilla (Mojang API) + Fabric (meta API + Maven libraries)
│   │       │   ├── ModrinthClient.ts          # Modrinth API wrapper (search, versions, downloads)
│   │       │   ├── JavaManager.ts             # System Java detection + Adoptium JDK download
│   │       │   ├── GoogleDriveService.ts      # OAuth 2.0 + Drive API v3 (upload/list/download)
│   │       │   ├── BackupScheduler.ts         # node-cron periodic world backup + zip + upload
│   │       │   └── NetworkManager.ts          # playit.gg agent download + tunnel management
│   │       ├── websocket/
│   │       │   └── index.ts                   # socket.io setup + room subscription
│   │       └── types/
│   │           └── nat-api.d.ts               # Type declaration for nat-api module
│   │
│   └── client/                                # Frontend — React 19 + Vite + shadcn/ui + Tailwind v4
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts                     # Vite config with proxy for /api + /socket.io
│       ├── index.html
│       └── src/
│           ├── main.tsx                       # Entry: QueryClient + ConsoleProvider + DownloadProgressProvider + App
│           ├── App.tsx                        # React Router v7 — 10 routes
│           ├── index.css                      # Tailwind v4 + dark theme CSS variables
│           ├── lib/
│           │   ├── api.ts                     # Axios instance with baseURL: /api
│           │   └── socket.ts                  # Socket.IO client singleton
│           ├── hooks/
│           │   ├── consoleContext.tsx          # Global console lines state (persists across tabs)
│           │   └── downloadProgress.tsx        # Global download progress bar context
│           ├── components/
│           │   ├── layout/
│           │   │   ├── AppLayout.tsx           # Sidebar + Outlet + Toaster
│           │   │   └── Sidebar.tsx            # Nav items, server selector, Drive/New Server buttons
│           │   ├── ui/                        # shadcn/ui components (14 files)
│           │   │   ├── badge.tsx
│           │   │   ├── button.tsx
│           │   │   ├── card.tsx
│           │   │   ├── dialog.tsx
│           │   │   ├── input.tsx
│           │   │   ├── label.tsx
│           │   │   ├── select.tsx
│           │   │   ├── separator.tsx
│           │   │   ├── slider.tsx
│           │   │   ├── switch.tsx
│           │   │   ├── table.tsx
│           │   │   ├── tabs.tsx
│           │   │   ├── textarea.tsx
│           │   │   ├── toaster.tsx
│           │   │   └── tooltip.tsx
│           │   └── NetworkCard.tsx            # Networking card for ServerDashboard
│           └── pages/
│               ├── Dashboard.tsx              # Server cards grid with status polling + start/stop
│               ├── ServerDashboard.tsx        # Per-server stats (status, uptime, RAM, port) + quick access
│               ├── NewServer.tsx              # Wizard: Vanilla/Fabric/Modpack with version + RAM selection
│               ├── Console.tsx                # Live terminal with regex highlighting + filter dropdown
│               ├── Mods.tsx                   # Installed tab (toggle/remove/check updates) + Browse tab (search/sort/categories/pagination/version dialog)
│               ├── Worlds.tsx                 # Worlds list + Local/Drive backup + Drive backup list
│               ├── Files.tsx                  # File browser with breadcrumbs + delete/download
│               ├── Players.tsx                # Online players with Op/Kick/Ban + Whitelist/Ops editor
│               ├── Settings.tsx               # Server properties editor (categorized tabs)
│               └── DriveSettings.tsx          # Google Drive OAuth setup + schedule + backup list
│
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts                      # Shared TypeScript interfaces (ServerConfig, ServerStatus, ModInfo, etc.)
│
├── mc-server-gui-design-system-v2.html        # Design system reference (Open Design output)
├── PROJECT_ARCHITECTURE.md                    # Full technical architecture document
├── SETUP_FOR_FRIENDS.md                       # Setup instructions for friends
├── start.bat                                  # One-click setup + launch script
│
├── package.json                               # Root: turborepo scripts
├── pnpm-workspace.yaml                        # pnpm monorepo config
├── turbo.json                                 # Turborepo task pipeline
└── .gitignore
```
