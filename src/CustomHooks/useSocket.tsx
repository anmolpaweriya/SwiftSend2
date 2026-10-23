import React, { useContext, useMemo } from "react";
import { io, Socket } from "socket.io-client";

const SocketContext = React.createContext<Socket | null>(null);

export function useSocket() {
  return useContext(SocketContext);
}

export default function SocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const socket = useMemo(() => {
    const hostname =
      typeof window !== "undefined" && window.location.hostname
        ? window.location.hostname
        : "localhost";
    const protocol =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "https:"
        : "http:";
    const serverUrl =
      import.meta.env.VITE_SERVER_URL || `${protocol}//${hostname}:8000`;

    return io(serverUrl, { autoConnect: false });
  }, []);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

