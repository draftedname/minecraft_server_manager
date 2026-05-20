# MC Server GUI - Setup for Friends

## What you need installed first

1. **Node.js** v18 or newer -- https://nodejs.org
2. **pnpm** -- after Node.js is installed, run: `npm install -g pnpm`
3. **Java** JDK 17 or newer -- https://adoptium.net

## Setup

1. Copy the entire `mcservergui` folder to your computer
2. Open a terminal (PowerShell or Command Prompt) in that folder
3. Install pnpm: `npm install -g pnpm`
4. Run: `pnpm install`
5. Run: `pnpm dev`
6. Open your browser to `http://localhost:5173`

## Troubleshooting

**"Cannot find matching keyid" error:** This happens on older Node.js with Corepack. Install pnpm directly:
```
npm install -g pnpm
```
Then retry. If that fails, update Node.js to v22+ from https://nodejs.org

## Access from other devices on your WiFi

The website is only on your computer by default. To let friends on the same WiFi access it, they need to connect to your computer's IP.

First, find your IP. Open a terminal and run:

```
ipconfig
```

Look for "IPv4 Address" under your WiFi/Ethernet adapter. It will be something like `192.168.1.100`.

Then, in the `mcservergui/apps/client` folder, edit the `vite.config.ts` file. Find the `server` section and add `host: true`:

```ts
server: {
  host: true,
  port: 5173,
  proxy: { ... }
}
```

Restart `pnpm dev`. Friends can now open `http://192.168.1.100:5173` (use your actual IP).

## Creating a server

1. Click "New Server" in the sidebar
2. Enter a name, pick Vanilla or Fabric, choose a version, set RAM
3. Click "Create Server"
4. Go to the server's Dashboard and click "Start"
5. Friends join using your local IP: `192.168.1.100:25565`

## Making it public (playit.gg)

1. Click "New Server", pick "Modpack", or use your existing server
2. On the server Dashboard, scroll to the Networking card
3. Toggle the switch on
4. Follow the setup guide that appears (create playit.gg account, set up a tunnel for port 25565 TCP)
5. After setup, toggle off and on again -- a public address appears
6. Share that address with anyone, anywhere

## Google Drive backups (optional)

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project, enable Google Drive API
3. Create an OAuth 2.0 Client ID for "Desktop app"
4. Download the JSON credentials file
5. In the app, go to Drive Backup in the sidebar
6. Paste the JSON and click Save Credentials
7. Click "Connect Google Account" and authorize
