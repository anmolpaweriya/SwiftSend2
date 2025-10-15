import React, { useContext } from "react";
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
  // const api = "https://swiftsend.publicvm.com";
  // const api = "http://localhost:8000";
  const api = "https://swiftsend.anmolpaweriya.online";
  const socket = io(api, { autoConnect: false });
  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
