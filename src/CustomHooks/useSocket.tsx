import React, { useContext } from "react";
import { io, Socket } from "socket.io-client";

const SocketContext = React.createContext<Socket | null>(null);


export function useSocket() { return useContext(SocketContext) }

export default function SocketProvider({ children }: { children: React.ReactNode }) {
    // const socket = io("http://localhost:8000", { autoConnect: false })
    const socket = io("https://swiftsend.publicvm.com", { autoConnect: false })
    return <SocketContext.Provider value={socket}>
        {children}
    </SocketContext.Provider>
}