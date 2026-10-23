import { useEffect, useRef, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import { ReactSVG } from "react-svg";
import downloadjs from "downloadjs";
import multiavatar from "@multiavatar/multiavatar/esm";

// components
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { ReactMarquee } from "./components/Marquee/ReactMarquee";
import { Progress } from "./components/ui/progress";
import { ChatModal, ChatMessage } from "./components/ChatModal";

// context api
import { useSocket } from "./CustomHooks/useSocket";

// device detection
import { getDeviceDefaultName } from "./lib/device";

// icons
import PropagateLoader from "react-spinners/PropagateLoader";
import { MdCopyAll } from "react-icons/md";
import { ImCross } from "react-icons/im";
import { FaDownload } from "react-icons/fa6";
import { Wifi, Pencil, Check, X, MessageSquare } from "lucide-react";

// types
type usersListType = {
  [key: string]: {
    id: string;
    name: string;
    image: string;
    file?: File;
    isNearby?: boolean;
  };
};

type openedUsersListType = {
  [key: string]: {
    id: string;
    type: "send" | "receive";
    fileName?: string;
    fileSize?: number;
    fileType?: string;
    offset?: number;
  };
};

type peerConnectionsType = {
  [key: string]: RTCPeerConnection;
};

type dataChannelsType = {
  [key: string]: RTCDataChannel;
};

type pendingRequestsType = {
  [key: string]: "waiting" | "downloading";
};

type downloadedChunks = {
  [key: string]: {
    file: ArrayBuffer[];
    fileSize: number;
    receivedDataSize: number;
    fileName: string;
    fileType: string;
    isFinished?: boolean;
  };
};

const STORAGE_USERNAME_KEY = "swiftsend_username";
const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk for optimal WebRTC throughput
const BUFFER_THRESHOLD = 512 * 1024; // 512 KB buffer threshold for backpressure control

function App() {
  // variables
  const queryParams = new URLSearchParams(window.location.search);
  const socket = useSocket();
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const otherRoomInputRef = useRef<HTMLInputElement>(null);
  const peerConnections = useRef<peerConnectionsType>({});
  const dataChannels = useRef<dataChannelsType>({});
  const downloadedChunks = useRef<downloadedChunks>({});
  const iceCandidatesQueue = useRef<{ [key: string]: RTCIceCandidateInit[] }>({});
  const selectedFiles = useRef<{ [key: string]: File }>({});

  const [username, setUsername] = useState<string>(() => {
    return localStorage.getItem(STORAGE_USERNAME_KEY) || "";
  });
  const [profileImage, setProfileImage] = useState("");
  const [room, setRoom] = useState(queryParams.get("room") || "");
  const [users, setUsers] = useState<usersListType>({});
  const [openedUser, setOpenedUser] = useState<openedUsersListType>({});
  const [pendingRequests, setPendingRequests] = useState<pendingRequestsType>({});
  const [isLoading, setIsLoading] = useState(true);

  // Chat Messaging State
  const [chatMessages, setChatMessages] = useState<{ [peerId: string]: ChatMessage[] }>({});
  const [activeChatPeerId, setActiveChatPeerId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<{ [peerId: string]: number }>({});
  const activeChatPeerIdRef = useRef<string | null>(activeChatPeerId);

  // Refs to avoid stale closures in WebRTC & socket callbacks
  const openedUserRef = useRef(openedUser);
  const usersRef = useRef(users);

  useEffect(() => {
    activeChatPeerIdRef.current = activeChatPeerId;
    if (activeChatPeerId) {
      setUnreadCounts((prev) => ({ ...prev, [activeChatPeerId]: 0 }));
    }
  }, [activeChatPeerId]);

  useEffect(() => {
    openedUserRef.current = openedUser;
  }, [openedUser]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  // Inline username editing on homepage
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState("");

  const iceServers = [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun3.l.google.com:19302"],
    },
  ];

  // Helper DOM lookup
  function _(id: string) {
    return document.getElementById(id);
  }

  const addRoomQueryParamToUrl = () => {
    const currentUrl = new URL(window.location.href);
    if (room && room !== "nearby") {
      currentUrl.searchParams.set("room", room);
    } else {
      currentUrl.searchParams.delete("room");
    }
    window.history.pushState(null, "", currentUrl.toString());
  };

  function fileSizeFormat(sizeByte: number) {
    if (!sizeByte || sizeByte <= 0) return "0 B";
    const format = ["B", "KB", "MB", "GB"];

    let n = 0;
    while (sizeByte > 1024 && n < format.length - 1) {
      sizeByte /= 1024;
      n++;
    }
    return `${sizeByte.toFixed(1)} ${format[n]}`;
  }

  async function getProfilePic(id: string) {
    try {
      const data = await multiavatar(id);
      return data;
    } catch (err) {
      return `
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="50" cy="50" r="50" fill="#6C63FF" />
        <circle cx="50" cy="35" r="18" fill="#FFD369" />
        <path
          d="M30 75c0-13 9-22 20-22s20 9 20 22"
          fill="#FF6B6B"
        />
        <circle cx="44" cy="33" r="2" fill="#333" />
        <circle cx="56" cy="33" r="2" fill="#333" />
        <path
          d="M44 40c2 2 6 2 8 0"
          stroke="#333"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
`;
    }
  }

  async function setProfilePicOnFirstLoad() {
    if (!socket?.id) return;
    const pic = await getProfilePic(socket.id);
    setProfileImage(pic);
  }

  async function copyRoomName() {
    const url = new URL(window.location.href);
    if (room) {
      url.searchParams.set("room", room);
      await navigator.clipboard.writeText(url.toString());
      toast.success("Room link copied to clipboard");
    } else {
      url.searchParams.delete("room");
      await navigator.clipboard.writeText(url.toString());
      toast.success("Share link copied to clipboard");
    }
  }

  async function addUser(id: string, name: string, isNearby?: boolean) {
    const image = await getProfilePic(id);
    setUsers((pre) => ({
      ...pre,
      [id]: {
        id,
        name,
        image,
        isNearby: Boolean(isNearby),
      },
    }));
  }

  function setFileToUser(id: string, file: File) {
    selectedFiles.current[id] = file;
    setUsers((pre) => {
      if (pre[id]) pre[id].file = file;
      return { ...pre };
    });

    openUser(id, "send", file.name, file.size, file.type);
  }

  function removeUser(id: string) {
    delete selectedFiles.current[id];
    setUsers((pre) => {
      delete pre[id];
      return { ...pre };
    });
    setOpenedUser((pre) => {
      delete pre[id];
      return { ...pre };
    });
    setPendingRequests((pre) => {
      delete pre[id];
      return { ...pre };
    });
    delete downloadedChunks.current[id];
    delete iceCandidatesQueue.current[id];

    if (activeChatPeerId === id) {
      setActiveChatPeerId(null);
    }

    if (peerConnections.current[id]) {
      try {
        peerConnections.current[id].close();
      } catch (e) {}
      delete peerConnections.current[id];
    }
    delete dataChannels.current[id];
  }

  function handleUserUpdated(id: string, newName: string) {
    setUsers((pre) => {
      if (!pre[id]) return pre;
      return {
        ...pre,
        [id]: {
          ...pre[id],
          name: newName,
        },
      };
    });
  }

  function handleNewUser(id: string, name: string, isNearby?: boolean) {
    addUser(id, name, isNearby);
    socket?.emit("user-connection-reply", id, username);
  }

  async function handleUserConnectionReply(
    id: string,
    name: string,
    isNearby?: boolean
  ) {
    addUser(id, name, isNearby);
    await createConnection(id);
    await createOffer(id);
  }

  function openUser(
    id: string,
    type: "send" | "receive",
    fileName: string = "",
    fileSize: number = 0,
    fileType: string = ""
  ) {
    setOpenedUser((pre) => ({
      ...pre,
      [id]: { id, type, fileName, fileSize, fileType, offset: 0 },
    }));
  }

  function closeUser(id: string) {
    if (Object.keys(pendingRequests).includes(id)) return;

    setOpenedUser((pre) => {
      if (pre[id]?.type === "send") delete pre[id];
      return { ...pre };
    });
  }

  function toggleOpenUser(id: string) {
    if (Object.keys(openedUser).includes(id)) closeUser(id);
    else openUser(id, "send");
  }

  function getFileForSend(id: string) {
    const fileInput = _(`file-${id}`) as HTMLInputElement;
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      fileInput?.click();
      return undefined;
    }
    return fileInput.files[0] as File;
  }

  function sendFile(id: string) {
    const file = selectedFiles.current[id] || usersRef.current[id]?.file || getFileForSend(id);
    if (!file) return;
    socket?.emit("send-file-request", id, file.name, file.size, file.type);
    setPendingRequests((pre) => ({ ...pre, [id]: "waiting" }));
  }

  function handleFileChange(e: any, id: string) {
    e.preventDefault();
    if (Object.keys(pendingRequests).includes(id)) return;
    const fileInput = _(`file-${id}`) as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>, id: string) {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    setFileToUser(id, file);
  }

  function handleFileRequest(
    id: string,
    fileName: string,
    fileSize: number,
    fileType?: string
  ) {
    downloadedChunks.current[id] = {
      file: [],
      fileSize: fileSize || 0,
      receivedDataSize: 0,
      fileName: fileName || "downloaded-file",
      fileType: fileType || "application/octet-stream",
      isFinished: false,
    };
    openUser(id, "receive", fileName, fileSize, fileType);
  }

  function cancelRequest(id: string) {
    setOpenedUser((pre) => {
      delete pre[id];
      return { ...pre };
    });
    setPendingRequests((pre) => {
      delete pre[id];
      return { ...pre };
    });
    delete downloadedChunks.current[id];

    socket?.emit("request-cancelled", id);
    if (dataChannels.current[id]?.readyState === "open") {
      try {
        dataChannels.current[id].send(
          JSON.stringify({ type: "transfer-cancel", id })
        );
      } catch (e) {}
    }
  }

  function acceptRequest(id: string) {
    socket?.emit("request-accepted", id);
    setPendingRequests((pre) => ({ ...pre, [id]: "downloading" }));

    const existing = downloadedChunks.current[id];
    const userMeta = openedUserRef.current[id];
    downloadedChunks.current[id] = {
      file: [],
      fileSize: existing?.fileSize || userMeta?.fileSize || 0,
      receivedDataSize: 0,
      fileName: existing?.fileName || userMeta?.fileName || "downloaded-file",
      fileType: existing?.fileType || userMeta?.fileType || "application/octet-stream",
      isFinished: false,
    };
  }

  function handleRequestCancelled(id: string) {
    delete downloadedChunks.current[id];
    setPendingRequests((pre) => {
      delete pre[id];
      return { ...pre };
    });
    setOpenedUser((pre) => {
      delete pre[id];
      return { ...pre };
    });
    toast.info("Transfer was cancelled");
  }

  // Messaging Functions
  function handleIncomingChatMessage(
    senderId: string,
    text: string,
    timestamp: number = Date.now(),
    msgId?: string
  ) {
    const id = msgId || `${senderId}-${timestamp}-${Math.random().toString(36).substring(2, 7)}`;
    const senderName = usersRef.current[senderId]?.name || "Connected User";

    const newMsg: ChatMessage = {
      id,
      senderId,
      senderName,
      text,
      timestamp,
    };

    setChatMessages((prev) => ({
      ...prev,
      [senderId]: [...(prev[senderId] || []), newMsg],
    }));

    // If chat with this user is not open, increment unread count & show toast notification
    if (activeChatPeerIdRef.current !== senderId) {
      setUnreadCounts((prev) => ({
        ...prev,
        [senderId]: (prev[senderId] || 0) + 1,
      }));
      toast.info(`Message from ${senderName}: ${text.length > 35 ? text.slice(0, 35) + "..." : text}`, {
        onClick: () => setActiveChatPeerId(senderId),
      });
    }
  }

  function sendChatMessage(targetId: string, text: string) {
    const timestamp = Date.now();
    const msgId = `msg-${timestamp}-${Math.random().toString(36).substring(2, 7)}`;

    const myMsg: ChatMessage = {
      id: msgId,
      senderId: "me",
      senderName: username,
      text,
      timestamp,
    };

    setChatMessages((prev) => ({
      ...prev,
      [targetId]: [...(prev[targetId] || []), myMsg],
    }));

    // Try WebRTC Data Channel first (p2p)
    const channel = dataChannels.current[targetId];
    if (channel && channel.readyState === "open") {
      try {
        channel.send(
          JSON.stringify({
            type: "chat-message",
            id: msgId,
            text,
            timestamp,
          })
        );
        return;
      } catch (err) {
        console.warn("Failed sending chat via data channel, falling back to socket", err);
      }
    }

    // Socket relay fallback
    socket?.emit("send-chat-message", targetId, text, timestamp);
  }

  // WebRTC Setup & Connection Handling
  function setupDataChannel(channel: RTCDataChannel, id: string) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_THRESHOLD;

    channel.onmessage = (event) => {
      handleFileTransfer(event, id);
    };

    dataChannels.current[id] = channel;
  }

  function createConnection(id: string) {
    const peer = new RTCPeerConnection({ iceServers });
    if (peerConnections.current[id]) {
      try {
        peerConnections.current[id].close();
      } catch (e) {}
    }
    peerConnections.current[id] = peer;

    // Create local data channel
    const channel = peer.createDataChannel("fileTransfer", { ordered: true });
    setupDataChannel(channel, id);

    // Bind incoming data channel from remote peer
    peer.ondatachannel = (event) => {
      setupDataChannel(event.channel, id);
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit("ice-candidate", JSON.stringify(event.candidate), id);
      }
    };

    return peer;
  }

  async function createOffer(id: string) {
    const peer = peerConnections.current[id];
    if (!peer) return;
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket?.emit("offer-send", JSON.stringify(offer), id);
    } catch (err) {
      console.error("Error creating offer:", err);
    }
  }

  async function handleOffer(offer: string, id: string) {
    try {
      const peer = createConnection(id);
      await peer.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(offer))
      );

      // Flush queued ICE candidates
      if (iceCandidatesQueue.current[id]) {
        for (const candidate of iceCandidatesQueue.current[id]) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        delete iceCandidatesQueue.current[id];
      }

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket?.emit("answer-send", JSON.stringify(answer), id);
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  }

  async function handleAnswer(answer: string, id: string) {
    try {
      const peer = peerConnections.current[id];
      if (!peer) return;
      await peer.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(answer))
      );

      // Flush queued ICE candidates
      if (iceCandidatesQueue.current[id]) {
        for (const candidate of iceCandidatesQueue.current[id]) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        delete iceCandidatesQueue.current[id];
      }
    } catch (err) {
      console.error("Error handling answer:", err);
    }
  }

  async function handleIceCandidate(candidateStr: string, id: string) {
    try {
      const candidate = JSON.parse(candidateStr);
      const peer = peerConnections.current[id];
      if (!peer) return;

      if (!peer.remoteDescription) {
        if (!iceCandidatesQueue.current[id]) {
          iceCandidatesQueue.current[id] = [];
        }
        iceCandidatesQueue.current[id].push(candidate);
      } else {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error("Error adding ice candidate:", err);
    }
  }

  function handleAcceptedRequest(id: string) {
    const file = selectedFiles.current[id] || usersRef.current[id]?.file || getFileForSend(id);
    if (!file) {
      toast.error("File not found for transfer");
      return;
    }

    startStreamingFile(file, id);
  }

  // Fast streaming file transfer with bufferedAmount flow control
  async function startStreamingFile(file: File, id: string) {
    const channel = dataChannels.current[id];
    if (!channel || channel.readyState !== "open") {
      toast.info("Establishing direct channel, starting transfer...");
      setTimeout(() => {
        if (dataChannels.current[id]?.readyState === "open") {
          startStreamingFile(file, id);
        } else {
          toast.error("Connection failed. Please retry.");
          setPendingRequests((prev) => {
            delete prev[id];
            return { ...prev };
          });
        }
      }, 1000);
      return;
    }

    setPendingRequests((pre) => ({ ...pre, [id]: "downloading" }));

    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_THRESHOLD;

    const fileSize = file.size;
    let offset = 0;

    const sendNextSlice = async () => {
      while (offset < fileSize) {
        if (channel.readyState !== "open") {
          toast.error("Transfer stopped: Channel closed");
          return;
        }

        // Backpressure check: wait if buffer exceeds threshold
        if (channel.bufferedAmount > BUFFER_THRESHOLD) {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            sendNextSlice();
          };
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        if (channel.readyState !== "open") return;

        channel.send(buffer);
        offset += buffer.byteLength;

        setOpenedUser((prev) => {
          if (!prev[id]) return prev;
          return {
            ...prev,
            [id]: {
              ...prev[id],
              offset,
            },
          };
        });
      }

      // Completed sending all chunks
      if (channel.readyState === "open") {
        channel.send(JSON.stringify({ type: "transfer-eof", id }));
      }
    };

    sendNextSlice();
  }

  async function handleFileTransfer(event: MessageEvent, id: string) {
    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "chat-message") {
          handleIncomingChatMessage(id, message.text, message.timestamp, message.id);
          return;
        }
        if (message.type === "transfer-eof") {
          finishDownload(id);
        } else if (message.type === "transfer-cancel") {
          handleRequestCancelled(id);
        }
      } catch (err) {}
      return;
    }

    let chunkBuffer: ArrayBuffer;
    if (event.data instanceof ArrayBuffer) {
      chunkBuffer = event.data;
    } else if (event.data instanceof Blob) {
      chunkBuffer = await event.data.arrayBuffer();
    } else if (ArrayBuffer.isView(event.data)) {
      chunkBuffer = event.data.buffer.slice(
        event.data.byteOffset,
        event.data.byteOffset + event.data.byteLength
      );
    } else {
      return;
    }

    if (!downloadedChunks.current[id]) {
      const userMeta = openedUserRef.current[id];
      downloadedChunks.current[id] = {
        file: [],
        fileSize: userMeta?.fileSize || 0,
        receivedDataSize: 0,
        fileName: userMeta?.fileName || "downloaded-file",
        fileType: userMeta?.fileType || "application/octet-stream",
        isFinished: false,
      };
    }

    const current = downloadedChunks.current[id];
    current.file.push(chunkBuffer);
    current.receivedDataSize += chunkBuffer.byteLength;

    setOpenedUser((pre) => {
      if (!pre[id]) return pre;
      return {
        ...pre,
        [id]: {
          ...pre[id],
          offset: current.receivedDataSize,
        },
      };
    });

    if (current.fileSize > 0 && current.receivedDataSize >= current.fileSize) {
      finishDownload(id);
    }
  }

  function saveFileToDisk(blob: Blob, fileName: string) {
    try {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        try {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        } catch (e) {}
      }, 60000);
    } catch (err) {
      console.error("Direct download failed, falling back to downloadjs:", err);
      try {
        downloadjs(blob, fileName);
      } catch (e) {
        console.error("downloadjs failed:", e);
      }
    }
  }

  function finishDownload(id: string) {
    const current = downloadedChunks.current[id];
    if (!current || current.isFinished) return;
    current.isFinished = true;

    const fileName =
      current.fileName ||
      openedUserRef.current[id]?.fileName ||
      "downloaded-file";
    const fileType =
      current.fileType ||
      openedUserRef.current[id]?.fileType ||
      "application/octet-stream";

    const blob = new Blob(current.file, { type: fileType });
    saveFileToDisk(blob, fileName);
    toast.success(`Downloaded: ${fileName}`);

    socket?.emit("transfer-finished", id);

    delete downloadedChunks.current[id];
    setPendingRequests((prev) => {
      delete prev[id];
      return { ...prev };
    });
    setOpenedUser((prev) => {
      delete prev[id];
      return { ...prev };
    });
  }

  function handleTransferFinished(id: string) {
    toast.success("File sent successfully!");
    setPendingRequests((pre) => {
      delete pre[id];
      return { ...pre };
    });

    setOpenedUser((pre) => {
      if (!pre[id]) return pre;
      return {
        ...pre,
        [id]: {
          ...pre[id],
          offset: 0,
        },
      };
    });
  }

  function transferedDataPercentage(id: string) {
    const user = openedUser[id];
    if (!user || !user.offset || !user.fileSize) return 0;
    return Math.min(100, (user.offset / user.fileSize) * 100);
  }

  function receivedDataPercentage(id: string) {
    const chunkData = downloadedChunks.current[id];
    const user = openedUser[id];
    const received = chunkData?.receivedDataSize || user?.offset || 0;
    const total = chunkData?.fileSize || user?.fileSize || 0;
    if (!received || !total) return 0;
    return Math.min(100, (received / total) * 100);
  }

  function changeRoom() {
    const newRoom = otherRoomInputRef.current?.value.trim();
    if (!newRoom) return;
    setRoom(newRoom);
    if (otherRoomInputRef.current) {
      otherRoomInputRef.current.value = "";
    }
  }

  function saveEditedUsername() {
    const newName = editingNameValue.trim();
    if (!newName) {
      setIsEditingUsername(false);
      return;
    }
    localStorage.setItem(STORAGE_USERNAME_KEY, newName);
    setUsername(newName);
    socket?.emit("update-username", newName);
    setIsEditingUsername(false);
    toast.success("Username updated!");
  }

  // Socket Connection and Event Listeners
  useEffect(() => {
    if (!username.length) return;
    addRoomQueryParamToUrl();

    if (!socket) return;

    const onConnect = () => {
      setIsLoading(false);
      socket.emit("join-room", room, username);
      setProfilePicOnFirstLoad();
    };

    socket.on("connect", onConnect);

    socket.on(
      "new-user",
      (id: string, name: string, meta?: { isNearby?: boolean }) => {
        handleNewUser(id, name, meta?.isNearby);
      }
    );

    socket.on(
      "user-connection-reply",
      (id: string, name: string, meta?: { isNearby?: boolean }) => {
        handleUserConnectionReply(id, name, meta?.isNearby);
      }
    );

    socket.on("user-updated", handleUserUpdated);
    socket.on("user-disconnected", removeUser);
    socket.on("receive-file-request", handleFileRequest);
    socket.on("request-cancelled", handleRequestCancelled);
    socket.on("request-accepted", handleAcceptedRequest);
    socket.on("transfer-finished", handleTransferFinished);

    socket.on("receive-chat-message", (senderId: string, text: string, timestamp: number) => {
      handleIncomingChatMessage(senderId, text, timestamp);
    });

    socket.on("offer-receive", handleOffer);
    socket.on("answer-receive", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);

    if (!socket.connected) {
      socket.connect();
    } else {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("new-user");
      socket.off("user-connection-reply");
      socket.off("user-updated");
      socket.off("user-disconnected");
      socket.off("receive-file-request");
      socket.off("request-cancelled");
      socket.off("request-accepted");
      socket.off("transfer-finished");
      socket.off("receive-chat-message");
      socket.off("offer-receive");
      socket.off("answer-receive");
      socket.off("ice-candidate");
    };
  }, [username, room, socket]);

  // Initial username setup modal (only asked if not present in localStorage)
  if (!username.length) {
    const defaultDeviceName = getDeviceDefaultName();
    return (
      <div className="w-full h-dvh flex justify-center items-center px-4">
        <Card className="w-full max-w-md mx-auto shadow-2xl border border-white/10">
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl font-bold">Welcome to SwiftSend</CardTitle>
            <CardDescription>
              Choose your display name to start sharing files and chatting
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const chosen =
                usernameInputRef.current?.value.trim() || defaultDeviceName;
              localStorage.setItem(STORAGE_USERNAME_KEY, chosen);
              setUsername(chosen);
            }}
          >
            <CardContent>
              <div className="grid w-full items-center gap-4">
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    ref={usernameInputRef}
                    placeholder="Enter your username"
                    defaultValue={defaultDeviceName}
                    required
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Auto-detected from your device info. You can change it anytime.
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full font-semibold">
                Continue
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  const activeChatPeer = activeChatPeerId ? users[activeChatPeerId] : null;

  return (
    <div className="min-h-screen w-full flex flex-col justify-between overflow-x-hidden relative">
      {isLoading && (
        <div className="w-full h-full fixed top-0 left-0 bg-[#181818] z-50 flex justify-center items-center">
          <PropagateLoader color="#fff" size={30} />
        </div>
      )}
      <ToastContainer
        position="top-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable
        pauseOnHover={false}
        theme="dark"
      />

      {/* Top Header Section */}
      <header className="relative w-full flex flex-col sm:flex-row items-start justify-between gap-6 px-4 sm:px-8 md:px-12 pt-6 sm:pt-10">
        {/* Responsive Fluid Animated Background Blob */}
        <div
          className="absolute pointer-events-none select-none -z-10 transition-all duration-300"
          style={{
            width: "clamp(300px, 60vw, 680px)",
            height: "clamp(300px, 60vw, 680px)",
            top: "clamp(-270px, -24vw, -120px)",
            left: "clamp(-220px, -20vw, -85px)",
          }}
        >
          <svg
            viewBox="0 0 900 900"
            className="w-full h-full filter drop-shadow-md opacity-85"
          >
            <g transform="translate(440.58175959586276 511.58956185041154)">
              <path fill="#5bb6ff">
                <animate
                  attributeName="d"
                  values="M188.8 -191C261.6 -116 349.3 -58 346.8 -2.5C344.4 53 251.7 106.1 178.9 147.7C106.1 189.4 53 219.7 -14.8 234.6C-82.7 249.4 -165.5 248.8 -227.8 207.1C-290.1 165.5 -332.1 82.7 -327.7 4.4C-323.3 -74 -272.7 -148 -210.4 -223C-148 -298 -74 -374 -8 -366C58 -358 116 -266 188.8 -191;

M263.6 -249.2C338.6 -188.6 394.3 -94.3 395.9 1.6C397.6 97.6 345.2 195.2 270.2 238.3C195.2 281.5 97.6 270.2 22.3 248C-53 225.7 -106.1 192.4 -163.2 149.2C-220.4 106.1 -281.7 53 -305.3 -23.6C-328.8 -100.2 -314.7 -200.3 -257.5 -261C-200.3 -321.7 -100.2 -342.8 -2.9 -339.9C94.3 -336.9 188.6 -309.9 263.6 -249.2;

M174.6 -154.1C243.1 -106.1 327 -53 345.2 18.1C363.3 89.3 315.7 178.7 247.2 251.3C178.7 324 89.3 380 -8.4 388.4C-106.1 396.7 -212.1 357.5 -258.8 284.8C-305.5 212.1 -292.7 106.1 -276.7 16C-260.7 -74 -241.4 -148 -194.7 -196C-148 -244 -74 -266 -10.5 -255.5C53 -245 106.1 -202.1 174.6 -154.1;
M235.2 -223.7C284.2 -186.2 289.1 -93.1 284.7 -4.4C280.4 84.4 266.8 168.8 217.8 224.6C168.8 280.4 84.4 307.7 2.7 305C-79 302.3 -157.9 269.6 -196.1 213.8C-234.3 157.9 -231.6 79 -245.2 -13.6C-258.7 -106.1 -288.5 -212.1 -250.3 -249.6C-212.1 -287.1 -106.1 -256.1 -6.5 -249.6C93.1 -243.1 186.2 -261.2 235.2 -223.7;

M188.8 -191C261.6 -116 349.3 -58 346.8 -2.5C344.4 53 251.7 106.1 178.9 147.7C106.1 189.4 53 219.7 -14.8 234.6C-82.7 249.4 -165.5 248.8 -227.8 207.1C-290.1 165.5 -332.1 82.7 -327.7 4.4C-323.3 -74 -272.7 -148 -210.4 -223C-148 -298 -74 -374 -8 -366C58 -358 116 -266 188.8 -191"
                  dur="4s"
                  repeatCount="indefinite"
                />
              </path>
            </g>
          </svg>
        </div>

        {/* User Profile Avatar & Name */}
        <div className="flex flex-col items-start select-none z-10">
          <div className="w-16 h-16 sm:w-20 sm:h-20 drop-shadow-lg">
            {profileImage && (
              <ReactSVG src={`data:image/svg+xml;base64,${btoa(profileImage)}`} />
            )}
          </div>

          {isEditingUsername ? (
            <div className="flex items-center gap-1 mt-2">
              <input
                type="text"
                value={editingNameValue}
                onChange={(e) => setEditingNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEditedUsername();
                  if (e.key === "Escape") setIsEditingUsername(false);
                }}
                autoFocus
                className="bg-white/95 text-black text-sm px-2.5 py-1 rounded outline-none w-32 text-center border border-gray-300 font-medium"
              />
              <button
                onClick={saveEditedUsername}
                className="text-emerald-400 hover:text-emerald-300 p-1"
                title="Save"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsEditingUsername(false)}
                className="text-red-400 hover:text-red-300 p-1"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div
              className="flex items-center justify-center gap-1.5 cursor-pointer group mt-2"
              onClick={() => {
                setEditingNameValue(username);
                setIsEditingUsername(true);
              }}
              title="Click to edit username"
            >
              <h1 className="font-semibold text-lg sm:text-xl text-white drop-shadow-md tracking-wide">
                {username}
              </h1>
              <Pencil className="w-3.5 h-3.5 text-gray-400 opacity-60 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </div>

        {/* Room Info & Join Input */}
        <div className="w-full max-w-xl flex flex-col items-center gap-3">
          <div className="text-white font-semibold flex flex-wrap gap-2 items-center justify-center text-sm sm:text-base">
            <span className="text-gray-300">Current Room:</span>
            <span className="text-green-400 font-mono bg-green-500/10 px-2.5 py-0.5 rounded border border-green-500/20">
              {room ? room : "Nearby (Same Wi-Fi)"}
            </span>
            <button
              className="text-lg rounded-lg p-1.5 bg-[#333] hover:bg-[#5bb6ff] transition-all hover:text-black active:scale-95"
              onClick={copyRoomName}
              title={room ? "Copy Room Link" : "Copy Invite Link"}
            >
              <MdCopyAll />
            </button>
          </div>

          <div className="flex w-full max-w-md bg-[#333] rounded-full p-1 text-base sm:text-lg overflow-hidden shadow-lg border border-white/5">
            <input
              type="text"
              spellCheck={false}
              ref={otherRoomInputRef}
              placeholder="Join Other Room"
              className="flex-1 min-w-0 bg-transparent px-4 sm:px-5 py-2.5 sm:py-3 text-white outline-none placeholder:text-gray-400 text-sm sm:text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter") changeRoom();
              }}
            />
            <button
              onClick={changeRoom}
              className="bg-[#5bb6ff] hover:bg-[#47a9f7] text-black font-semibold rounded-full px-5 py-2 sm:py-2.5 text-sm sm:text-base transition-all active:scale-95 flex-shrink-0"
            >
              Connect
            </button>
          </div>
        </div>
      </header>

      {/* Connected Section */}
      <section className="flex-1 w-full px-4 sm:px-8 md:px-12 mt-10 sm:mt-16 pb-12">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">Connected</h1>
          <span className="text-xs bg-white/10 text-gray-300 px-3 py-1 rounded-full flex items-center gap-1.5 border border-white/5">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            Auto-discovering devices on your Wi-Fi
          </span>
        </div>

        <div className="flex gap-4 sm:gap-6 flex-wrap justify-center sm:justify-start items-start">
          {Object.values(users).length === 0 ? (
            <p className="text-gray-400 text-sm py-8 px-2 max-w-md">
              Looking for devices on the same Wi-Fi network... Open SwiftSend on
              another device or invite someone to connect!
            </p>
          ) : (
            Object.values(users).map((user) => {
              return (
                <div
                  key={user.id}
                  className="flex flex-col items-center select-none"
                >
                  {/* Expanding User Pill for File Sharing */}
                  <div
                    className={
                      "transition-all duration-300 h-14 flex relative rounded-full overflow-hidden shadow-lg " +
                      (Object.keys(openedUser).includes(user.id)
                        ? "w-[280px] sm:w-[300px]"
                        : "w-14") +
                      (openedUser[user.id]?.type === "receive"
                        ? " bg-[#0f0] "
                        : " bg-[#5BB6FF] ")
                    }
                  >
                    <div
                      onClick={() => toggleOpenUser(user.id)}
                      className="w-14 h-14 rounded-full absolute top-0 left-0 cursor-pointer flex-shrink-0 active:scale-95 transition-transform"
                      title="Click to send files"
                    >
                      <ReactSVG
                        src={`data:image/svg+xml;base64,${btoa(user.image)}`}
                      />
                    </div>

                    {openedUser[user.id]?.type === "send" && (
                      <div className="ml-14 text-black text-sm grid items-center box-border px-4 sm:px-5 w-full">
                        <div
                          id={`para-${user.id}`}
                          className="text-center text-xs w-[180px] sm:w-[200px] cursor-pointer"
                          onClick={(e) => handleFileChange(e, user.id)}
                        >
                          {user.file ? (
                            <div className="w-full flex items-center justify-center">
                              <ReactMarquee className="w-full">
                                {user.file.name}
                              </ReactMarquee>
                              <span className="whitespace-nowrap ml-1 font-mono text-[11px]">
                                ({fileSizeFormat(user.file.size)})
                              </span>
                            </div>
                          ) : (
                            <span className="font-medium hover:underline">Choose File</span>
                          )}
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          id={`file-${user.id}`}
                          onChange={(e) => handleFileInputChange(e, user.id)}
                        />
                        {pendingRequests[user.id] === "downloading" ? (
                          <Progress value={transferedDataPercentage(user.id)} />
                        ) : Object.keys(pendingRequests).includes(user.id) ? (
                          <p className="bg-white rounded-lg text-center w-full py-0.5 text-xs font-medium">
                            {pendingRequests[user.id]} ...
                          </p>
                        ) : (
                          <button
                            id={`btn-${user.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              sendFile(user.id);
                            }}
                            className="bg-white rounded-lg w-full font-medium hover:bg-white/90 py-0.5 active:scale-95 transition-transform"
                          >
                            send
                          </button>
                        )}
                      </div>
                    )}

                    {openedUser[user.id]?.type === "receive" && (
                      <div className="ml-14 text-black text-sm grid items-center box-border px-4 sm:px-5 w-full">
                        <div
                          id={`para-${user.id}`}
                          className="text-center text-xs w-[180px] sm:w-[200px]"
                        >
                          <div className="w-full flex items-center justify-center">
                            <ReactMarquee className="w-full">
                              {openedUser[user.id]?.fileName}
                            </ReactMarquee>
                            <span className="whitespace-nowrap ml-1 font-mono text-[11px]">
                              ({fileSizeFormat(openedUser[user.id]?.fileSize || 0)})
                            </span>
                          </div>
                        </div>

                        {Object.keys(pendingRequests).includes(user.id) ? (
                          <Progress value={receivedDataPercentage(user.id)} />
                        ) : (
                          <div className="w-full flex justify-between box-border px-4 sm:px-5 items-center">
                            <button
                              onClick={() => cancelRequest(user.id)}
                              className="bg-red-500 text-sm p-1.5 text-white rounded-lg hover:bg-red-600 active:scale-95 transition-all"
                              title="Decline"
                            >
                              <ImCross />
                            </button>
                            <button
                              onClick={() => acceptRequest(user.id)}
                              className="text-[#0f0] bg-black text-sm p-1.5 rounded-lg hover:bg-zinc-900 active:scale-95 transition-all"
                              title="Accept & Download"
                            >
                              <FaDownload />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Peer Name + Status & Direct Chat Button */}
                  <div className="flex flex-col items-center mt-2 gap-1">
                    <p className="text-center text-sm font-medium flex items-center justify-center gap-1 text-gray-200">
                      <span>{user.name}</span>
                      {user.isNearby && (
                        <span
                          className="inline-flex items-center text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.2 rounded-full font-normal"
                          title="Connected on the same Wi-Fi network"
                        >
                          Nearby
                        </span>
                      )}
                    </p>

                    <button
                      onClick={() => setActiveChatPeerId(user.id)}
                      className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-xs font-medium text-gray-200 hover:text-white border border-white/5 shadow-sm"
                      title={`Chat with ${user.name}`}
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#5bb6ff]" />
                      <span>Chat</span>
                      {(unreadCounts[user.id] || 0) > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-bounce">
                          {unreadCounts[user.id]}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Chat Modal for Connected Peer */}
      {activeChatPeer && (
        <ChatModal
          peer={activeChatPeer}
          isOpen={Boolean(activeChatPeerId)}
          onClose={() => setActiveChatPeerId(null)}
          messages={chatMessages[activeChatPeer.id] || []}
          onSendMessage={(text) => sendChatMessage(activeChatPeer.id, text)}
        />
      )}
    </div>
  );
}

export default App;
