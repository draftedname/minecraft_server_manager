// MC Server GUI
import { Server } from "socket.io";

let io: Server | null = null;

export function setupWebSocket(server: Server) {
  io = server;

  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("console:subscribe", (serverId: string) => {
      socket.join(`server:${serverId}`);
      console.log(`Socket ${socket.id} subscribed to server ${serverId}`);
    });

    socket.on("console:unsubscribe", (serverId: string) => {
      socket.leave(`server:${serverId}`);
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

