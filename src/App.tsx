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

// context api
import { useSocket } from "./CustomHooks/useSocket";

// icons
import PropagateLoader from "react-spinners/PropagateLoader";
import { MdCopyAll } from "react-icons/md";
import { ImCross } from "react-icons/im";
import { FaDownload } from "react-icons/fa6";

// types
type usersListType = {
  [key: string]: {
    id: string;
    name: string;
    image: string;
    file?: File;
  };
};
type openedUsersListType = {
  [key: string]: {
    id: string;
    type: "send" | "receive";
    fileName?: string;
    fileSize?: number;
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
  };
};

function App() {
  // variables
  const queryParams = new URLSearchParams(window.location.search);
  const socket = useSocket();
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const otherRoomInputRef = useRef<HTMLInputElement>(null);
  const peerConnections = useRef<peerConnectionsType>({});
  const dataChannels = useRef<dataChannelsType>({});
  const downloadedChunks = useRef<downloadedChunks>({});

  const [username, setUsername] = useState("");
  const [profileImage, setProfileImage] = useState("");
  const [room, setRoom] = useState(queryParams.get("room") || "");
  const [users, setUsers] = useState<usersListType>({});
  const [openedUser, setOpenedUser] = useState<openedUsersListType>({});
  const [pendingRequests, setPendingRequests] = useState<pendingRequestsType>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);

  const MAX_CHUNK_SIZE = 200 * 1024; // 500kb
  const iceServers = [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun3.l.google.com:19302"],
    },
  ];

  // functions

  function _(id: string) {
    return document.getElementById(id);
  }

  const addRoomQueryParamToUrl = () => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("room", room);
    window.history.pushState(null, "", currentUrl.toString());
  };

  function fileSizeFormat(sizeByte: number) {
    const format = ["B", "KB", "MB", "GB"];

    let n = 0;
    while (sizeByte > 1024) {
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
    await navigator.clipboard.writeText(room);
    toast.success("Copied To Clipboard");
  }

  async function addUser(id: string, name: string) {
    const image = await getProfilePic(id);
    setUsers((pre) => ({
      ...pre,
      [id]: {
        id,
        name,
        image,
      },
    }));
  }

  function setFileToUser(id: string, file: File) {
    setUsers((pre) => {
      if (pre[id]) pre[id].file = file;
      return { ...pre };
    });

    openUser(id, "send", file.name, file.size);
  }

  function removeUser(id: string) {
    setUsers((pre) => {
      delete pre[id];
      return { ...pre };
    });
  }

  function handleNewUser(id: string, name: string) {
    addUser(id, name);
    socket?.emit("user-connection-reply", id, username);
  }

  async function handleUserConnectionReply(id: string, name: string) {
    addUser(id, name);
    await createConnection(id);
    await createOffer(id);
  }

  function openUser(
    id: string,
    type: "send" | "receive",
    fileName: string = "",
    fileSize: number = 0,
  ) {
    setOpenedUser((pre) => ({
      ...pre,
      [id]: { id, type, fileName, fileSize, offset: 0 },
    }));
  }
  function closeUser(id: string) {
    if (Object.keys(pendingRequests).includes(id)) return;

    setOpenedUser((pre) => {
      if (pre[id].type == "send") delete pre[id];
      return { ...pre };
    });
  }

  function toggleOpenUser(id: string) {
    if (Object.keys(openedUser).includes(id)) closeUser(id);
    else openUser(id, "send");
  }

  function getFileForSend(id: string) {
    const fileInput = _(`file-${id}`) as HTMLFormElement;
    if (!fileInput.files[0]) {
      fileInput.click();
      return;
    }
    return fileInput.files[0] as File;
  }

  function sendFile(id: string) {
    const file = getFileForSend(id);
    if (!file) return;
    socket?.emit("send-file-request", id, file.name, file.size);
    setPendingRequests((pre) => ({ ...pre, [id]: "waiting" }));
  }

  function handleFileChange(e: any, id: string) {
    e.preventDefault();
    if (Object.keys(pendingRequests).includes(id)) return;
    const fileInput = _(`file-${id}`) as HTMLFormElement;
    fileInput?.click();
    if (!fileInput.files[0]) return;
    const file = fileInput.files[0] as File;
    if (!file) return;
    setFileToUser(id, file);
  }

  function handleFileRequest(id: string, fileName: string, fileSize: number) {
    openUser(id, "receive", fileName, fileSize);
  }

  function cancelRequest(id: string) {
    setOpenedUser((pre) => {
      delete pre[id];
      return { ...pre };
    });
    socket?.emit("request-cancelled", id);
  }
  function acceptRequest(id: string) {
    socket?.emit("request-accepted", id);
    setPendingRequests((pre) => ({ ...pre, [id]: "downloading" }));

    if (!downloadedChunks.current[id]) {
      downloadedChunks.current[id] = {
        file: [],
        fileSize: openedUser[id].fileSize!,
        receivedDataSize: 0,
      };
    }
  }

  function handleRequestCancelled(id: string) {
    setPendingRequests((pre) => {
      delete pre[id];
      return { ...pre };
    });
  }

  function createConnection(id: string) {
    const peer = new RTCPeerConnection({ iceServers });
    peerConnections.current[id]?.close();
    peerConnections.current[id] = peer;

    dataChannels.current[id] = peer.createDataChannel("sendDataChannel");

    dataChannels.current[id].onmessage = (event) =>
      handleFileTransfer(event, id);
    peer.ondatachannel = (event) => {
      dataChannels.current[id] = event.channel;
    };

    peer.onicecandidate = (event) => {
      if (event.candidate)
        socket?.emit("ice-candidate", JSON.stringify(event.candidate), id);
    };

    return peer;
  }

  async function createOffer(id: string) {
    const peer = peerConnections.current[id];
    if (!peer) return;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket?.emit("offer-send", JSON.stringify(offer), id);
  }

  async function handleOffer(offer: string, id: string) {
    const peer = createConnection(id);

    await peer.setRemoteDescription(
      new RTCSessionDescription(JSON.parse(offer)),
    );
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket?.emit("answer-send", JSON.stringify(answer), id);
  }

  async function handleAnswer(answer: string, id: string) {
    const peer = peerConnections.current[id];
    if (!peer) return;
    await peer.setRemoteDescription(
      new RTCSessionDescription(JSON.parse(answer)),
    );
  }
  async function handleIceCandidate(candidate: string, id: string) {
    const peer = peerConnections.current[id];
    if (!peer) return;
    await peer.addIceCandidate(JSON.parse(candidate));
  }

  function handleAcceptedRequest(id: string) {
    const file = _(`file-${id}`) as HTMLInputElement;
    if (!file || !file.files) return;
    setPendingRequests((pre) => ({ ...pre, [id]: "downloading" }));

    sendFileInChunks(file.files[0], id);
  }

  function sendFileInChunks(file: File, id: string) {
    setOpenedUser((pre) => {
      const offset = pre[id].offset || 0;
      const fileReader = new FileReader();
      const chunk = file.slice(offset, offset + MAX_CHUNK_SIZE);
      fileReader.onloadend = () => {
        if (fileReader.result instanceof ArrayBuffer) {
          dataChannels.current[id].send(fileReader.result);
          setOpenedUser((preValue) => {
            preValue[id].offset = offset + MAX_CHUNK_SIZE;
            return { ...preValue };
          });
        }
      };
      fileReader.readAsArrayBuffer(chunk);
      return { ...pre };
    });
  }

  function handleFileTransfer(event: MessageEvent, id: string) {
    if (typeof event.data == "string") {
      try {
        const message = JSON.parse(event.data);
        if (message.ack) handleAcceptedRequest(id);
      } catch (err) {}
      return;
    }
    if (!(event.data instanceof ArrayBuffer)) return;
    downloadedChunks.current[id].file.push(event.data);
    downloadedChunks.current[id].receivedDataSize += event.data.byteLength;

    setOpenedUser((pre) => {
      if (
        downloadedChunks.current[id].receivedDataSize <
        downloadedChunks.current[id].fileSize
      ) {
        // todo
        // socket?.emit('request-accepted', id)
        const ackMessage = { ack: { id } };
        dataChannels.current[id].send(JSON.stringify(ackMessage));
        return { ...pre };
      }

      // downloading finished
      socket?.emit("transfer-finished", id);

      const fileName = pre[id].fileName;
      downloadjs(new Blob(downloadedChunks.current[id].file), fileName);

      // cleanup
      delete pre[id];
      delete downloadedChunks.current[id];
      setPendingRequests((pendingPre) => {
        delete pendingPre[id];
        return { ...pendingPre };
      });
      return { ...pre };
    });
  }

  function handleTransferFinished(id: string) {
    setPendingRequests((pre) => {
      delete pre[id];
      return { ...pre };
    });

    setOpenedUser((pre) => {
      pre[id].offset = 0;
      return { ...pre };
    });
  }

  function transferedDataPercentage(id: string) {
    if (!openedUser[id].offset) return 0;
    if (!openedUser[id].fileSize) return 0;
    return (openedUser[id].offset / openedUser[id].fileSize) * 100;
  }

  function receivedDataPercentage(id: string) {
    return (
      (downloadedChunks.current[id].receivedDataSize /
        downloadedChunks.current[id].fileSize) *
      100
    );
  }

  function changeRoom() {
    if (
      !otherRoomInputRef.current ||
      !otherRoomInputRef.current.value.trim().length
    )
      return;
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("room", otherRoomInputRef.current.value.trim());
    window.location.href = currentUrl.toString();
  }

  // use effects
  useEffect(() => {
    if (!username.length) return;
    if (!room.length) return;
    addRoomQueryParamToUrl();
    if (socket?.connected) return;

    socket?.on("connect", () => {
      setIsLoading(false);
      socket.emit("join-room", room, username);
      setProfilePicOnFirstLoad();

      socket.on("new-user", handleNewUser);
      socket.on("user-connection-reply", handleUserConnectionReply);
      socket.on("user-disconnected", removeUser);
      socket.on("receive-file-request", handleFileRequest);
      socket.on("request-cancelled", handleRequestCancelled);
      socket.on("request-accepted", handleAcceptedRequest);
      socket.on("transfer-finished", handleTransferFinished);

      socket.on("offer-receive", handleOffer);
      socket.on("answer-receive", handleAnswer);
      socket.on("ice-candidate", handleIceCandidate);
    });
    socket?.connect();
  }, [username, room, isLoading]);

  if (!username.length || !room.length)
    return (
      <div className="w-full h-dvh flex justify-center items-center">
        <Card className="w-full max-w-md max-sm:max-w-sm mx-10">
          <CardHeader>
            <CardTitle>Create Username</CardTitle>
            <CardDescription>
              Choose a unique username for your account
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (usernameInputRef.current)
                setUsername(usernameInputRef.current.value);
              if (roomInputRef.current) setRoom(roomInputRef.current.value);
            }}
          >
            <CardContent>
              <div className="grid w-full items-center gap-4">
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    ref={usernameInputRef}
                    placeholder="Enter your username"
                    required
                  />
                </div>
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="username">Room</Label>
                  <Input
                    ref={roomInputRef}
                    placeholder="Enter Room Name"
                    required
                    defaultValue={room}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full">
                Submit
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  return (
    <>
      {isLoading && (
        <div className="w-full h-full absolute top-0 left-0 bg-[#181818] z-10 flex justify-center items-center">
          <PropagateLoader color="#fff" size={30} />
        </div>
      )}
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable
        pauseOnHover={false}
        theme="dark"
      />
      <section className="h-[300px] text-black grid sm:grid-cols-[1fr_3fr] py-10 ">
        <svg
          viewBox="0 0 900 900"
          className="w-[600px] absolute top-[-300px] left-[-250px] z-[-1]"
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
              ></animate>
            </path>
          </g>
        </svg>

        <div className="top-[50px] left-[75px] justify-self-start mt-[30px] ml-[50px] ">
          <div className="w-20">
            <ReactSVG src={`data:image/svg+xml;base64,${btoa(profileImage)}`} />
          </div>

          <h1 className="font-semibold text-center text-xl drop-shadow-md">
            {username}
          </h1>
        </div>

        <div className="w-full flex flex-col gap-3 justify-center items-center max-sm:mt-[50px]">
          <div className="text-white font-semibold flex gap-2 items-center justify-center">
            <span>Current Room:</span>
            <span className="text-green-400">{room}</span>
            <button
              className="text-xl rounded-lg p-2 bg-[#333] hover:bg-blue-400 transition-all hover:text-black"
              onClick={copyRoomName}
            >
              <MdCopyAll />
            </button>
          </div>

          <div className="grid grid-cols-[auto_150px] w-[80%] max-w-[600px] bg-[#333] rounded-full p-1 text-lg overflow-hidden">
            <input
              type="text"
              spellCheck={false}
              ref={otherRoomInputRef}
              placeholder="Join Other Room"
              className="h-full w-full bg-inherit px-5 py-4 text-white outline-none"
            />
            <button onClick={changeRoom} className="bg-blue-400 rounded-full">
              Connect
            </button>
          </div>
        </div>
      </section>

      <section className="mt-20">
        <h1 className="text-3xl ml-3">Connected</h1>
        <div className=" flex gap-5 flex-wrap m-5">
          {Object.values(users).map((user) => {
            return (
              <div
                key={user.id}
                className="select-none active:scale-95 transition-all  "
              >
                <div
                  className={
                    "transition-all duration-300 h-14 flex relative  rounded-full overflow-hidden " +
                    (Object.keys(openedUser).includes(user.id)
                      ? "w-[300px]"
                      : "w-14") +
                    (openedUser[user.id]?.type == "receive"
                      ? " bg-[#0f0] "
                      : " bg-[#5BB6FF] ")
                  }
                >
                  <div
                    onClick={() => toggleOpenUser(user.id)}
                    className="w-14 h-14 rounded-full absolute top-0 left-0 "
                  >
                    <ReactSVG
                      src={`data:image/svg+xml;base64,${btoa(user.image)}`}
                    />
                  </div>

                  {openedUser[user.id]?.type == "send" && (
                    <div className="ml-14 text-black text-sm grid items-center box-border px-5 w-full">
                      <p
                        id={`para-${user.id}`}
                        className="text-center text-xs w-[200px]"
                        onClick={(e) => handleFileChange(e, user.id)}
                      >
                        {user.file ? (
                          <p className="w-full flex ">
                            <ReactMarquee className="w-full">
                              {user.file.name}
                            </ReactMarquee>
                            <span className="whitespace-nowrap">
                              ({fileSizeFormat(user.file.size)})
                            </span>
                          </p>
                        ) : (
                          "Choose File"
                        )}
                      </p>
                      <input
                        type="file"
                        className="hidden"
                        id={`file-${user.id}`}
                        onChange={(e) => handleFileChange(e, user.id)}
                      />
                      {pendingRequests[user.id] == "downloading" ? (
                        <Progress value={transferedDataPercentage(user.id)} />
                      ) : Object.keys(pendingRequests).includes(user.id) ? (
                        <p className="bg-white rounded-lg text-center w-full">
                          {pendingRequests[user.id]} ...
                        </p>
                      ) : (
                        <button
                          id={`btn-${user.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            sendFile(user.id);
                          }}
                          className="bg-white rounded-lg w-full"
                        >
                          send
                        </button>
                      )}
                    </div>
                  )}

                  {openedUser[user.id]?.type == "receive" && (
                    <div className="ml-14 text-black text-sm grid items-center box-border px-5 w-full">
                      <p
                        id={`para-${user.id}`}
                        className="text-center text-xs w-[200px]"
                        onClick={() => _(`file-${user.id}`)?.click()}
                      >
                        <p className="w-full flex ">
                          <ReactMarquee className="w-full">
                            {openedUser[user.id]?.fileName}
                          </ReactMarquee>
                          <span className="whitespace-nowrap">
                            ({fileSizeFormat(openedUser[user.id].fileSize!)})
                          </span>
                        </p>
                      </p>

                      {Object.keys(pendingRequests).includes(user.id) ? (
                        <Progress value={receivedDataPercentage(user.id)} />
                      ) : (
                        <div className="w-full flex justify-between box-border px-5 items-center">
                          <button
                            onClick={() => cancelRequest(user.id)}
                            className="bg-red-500 text-md p-2 text-white rounded-lg"
                          >
                            <ImCross />
                          </button>
                          <button
                            onClick={() => acceptRequest(user.id)}
                            className="text-[#0f0] bg-black text-md p-2 rounded-lg"
                          >
                            <FaDownload />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-center">{user.name}</p>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

export default App;
