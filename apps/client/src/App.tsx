import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import NewServer from "./pages/NewServer";
import Console from "./pages/Console";
import Mods from "./pages/Mods";
import Worlds from "./pages/Worlds";
import Players from "./pages/Players";
import Settings from "./pages/Settings";
import Files from "./pages/Files";
import ServerDashboard from "./pages/ServerDashboard";
import DriveSettings from "./pages/DriveSettings";

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/:serverId" element={<ServerDashboard />} />
          <Route path="/new" element={<NewServer />} />
          <Route path="/:serverId/console" element={<Console />} />
          <Route path="/:serverId/mods" element={<Mods />} />
          <Route path="/:serverId/worlds" element={<Worlds />} />
          <Route path="/:serverId/players" element={<Players />} />
          <Route path="/:serverId/settings" element={<Settings />} />
          <Route path="/:serverId/files" element={<Files />} />
          <Route path="/drive" element={<DriveSettings />} />
        </Route>
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
