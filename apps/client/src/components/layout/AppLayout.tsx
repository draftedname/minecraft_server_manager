import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { Toaster } from "../ui/toaster";
import { toast } from "../ui/toaster";
import { getSocket } from "@/lib/socket";

export default function AppLayout() {
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const handler = (data: { serverId: string; status: string }) => {
      if (data.status === "crashed") {
        toast({
          title: "Server Crashed!",
          description: `Server ${data.serverId} has unexpectedly crashed.`,
          variant: "destructive",
        });
      }
    };

    socket.on("server:status", handler);
    return () => {
      socket.off("server:status", handler);
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
