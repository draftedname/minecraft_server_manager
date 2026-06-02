================================================================================
  MC SERVER GUI
  A standalone desktop application for managing Minecraft servers
  License: GNU General Public License v3.0
================================================================================

MC Server GUI lets you create, configure, run, and manage Minecraft servers
entirely through a web-based dashboard — no command line, no VPS, no Docker
required. Java is auto-downloaded on first launch. Packaged as a single
Electron executable for Windows.


TABLE OF CONTENTS
  1. Tech Stack
  2. Getting Started — For Developers
  3. Getting Started — For Regular Users
  4. Usage & API Documentation
  5. License
  6. Contact


================================================================================
1. TECH STACK
================================================================================

  Desktop Shell     Electron 34
  Backend           Node.js, Express 5, TypeScript, Socket.IO
  Frontend          React 19, TypeScript, Vite 6, Tailwind CSS v4, shadcn/ui
  Monorepo          Turborepo + pnpm workspaces + node-linker=hoisted
  Real-time         Socket.IO (WebSocket)
  State Mgmt        TanStack React Query v5 (auto-polling, mutation invalidation)
  Minecraft Proc    child_process.spawn with shell:false (no injection risk)
  Mods API          Modrinth REST API v2
  Server Jars       Mojang version manifest, Fabric meta API, Maven
  Cloud Backup      Google Drive API v3 (OAuth 2.0)
  Tunneling         playit.gg via Windows Service Control Manager (sc.exe)
  Scheduling        node-cron
  Archiving         archiver, extract-zip
  Packaging         electron-builder 25 (NSIS installer)
  Package Mgr      pnpm 11


================================================================================
2. GETTING STARTED — FOR DEVELOPERS
================================================================================

PREREQUISITES

  - Node.js 18+ (https://nodejs.org)
  - pnpm: npm install -g pnpm
  - Java JDK 17+ (for running servers)
  - Git

INSTALLATION

  git clone https://github.com/draftedname/mcservergui.git
  cd mcservergui
  pnpm install

RUN IN DEVELOPMENT MODE

  pnpm dev

  This starts:
    - Express backend with hot reload on port 3456
    - Vite frontend with HMR on port 5173 (proxy: /api -> 3456)

  Open http://localhost:5173 in your browser.

BUILD FOR PRODUCTION

  pnpm build
  npx electron-builder --win --dir

  Output: dist-electron/win-unpacked/MC Server GUI.exe

BUILD INSTALLER

  pnpm build
  npx electron-builder --win

  Output: dist-electron/MC Server GUI Setup 1.0.0.exe

ENVIRONMENT VARIABLES

  MCSERVERGUI_WEB_PORT   Web UI port (default: 8080)
  MCSERVERGUI_DATA_DIR   Override data directory (default: OS sandbox)


================================================================================
3. GETTING STARTED — FOR REGULAR USERS
================================================================================

PREREQUISITES

  - Windows 10 or newer
  - No manual Java install needed (downloaded automatically on first start)

INSTALLATION

  1. Download the latest installer from the GitHub Releases page
  2. Run "MC Server GUI Setup 1.0.0.exe"
  3. Follow the installer steps (default settings are fine)
  4. Launch MC Server GUI from the desktop shortcut or Start Menu

  OR download the portable version (no install required):
  1. Extract the zip to any folder
  2. Double-click "MC Server GUI.exe"

USING THE APP

  1. The app opens a desktop window with the web dashboard
  2. Click "New Server" in the sidebar to create your first server
  3. Choose a type (Vanilla, Fabric, or Modpack from Modrinth)
  4. Select a Minecraft version and set RAM, then click "Create"
  5. On the server dashboard, click "Start"
  6. Friends can join using your local IP: 192.168.x.x:25565

  To make your server public (no port forwarding needed):
  1. Install playit.gg from https://playit.gg/download
  2. In the app, go to your server's Dashboard
  3. Toggle the Networking switch ON
  4. Follow the on-screen guide to link your playit.gg account

CHANGING THE PORT

  By default the web UI runs on port 8080. To change it, create a
  shortcut to the exe and add the environment variable:

  set MCSERVERGUI_WEB_PORT=9090 && start MC Server GUI.exe


================================================================================
4. USAGE & API DOCUMENTATION
================================================================================

The web dashboard is self-documenting through its 10 pages:

  Dashboard (/) ............... Server cards, status, start/stop/delete
  Server Dashboard (/id) ...... Stats, RAM slider, networking toggle
  New Server (/new) ........... Create Vanilla/Fabric/Modpack servers
  Console (/id/console) ....... Live terminal, filter, command history
  Mods (/id/mods) ............. Browse & install Modrinth mods, updates
  Worlds (/id/worlds) ......... Backup, restore, import, activate worlds
  Files (/id/files) ........... File browser, chunked upload, import as world
  Players (/id/players) ....... Online players, whitelist, ops editor
  Settings (/id/settings) ..... Server.properties editor (categorized)
  Drive Settings (/drive) ..... Google Drive OAuth, backup schedule

Full API documentation is available in TECHNICAL_REPORT.txt
inside the repository. Every route, request body, and response is documented.


================================================================================
5. LICENSE
================================================================================

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.


================================================================================
6. CONTACT
================================================================================

  Email: imusingscout@gmail.com
  X:     @drafted_name

  Bug reports and feature requests: GitHub Issues
  Sponsor inquiries: email above
