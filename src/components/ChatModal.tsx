import React, { useState, useRef, useEffect } from "react";
import { ReactSVG } from "react-svg";
import { X, Send, Copy, Check, MessageSquare } from "lucide-react";
import { toast } from "react-toastify";

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
};

interface ChatModalProps {
  peer: {
    id: string;
    name: string;
    image: string;
    isNearby?: boolean;
  };
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  peer,
  isOpen,
  onClose,
  messages,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, messages]);

  if (!isOpen) return null;

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText("");
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Message copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm transition-all animate-in fade-in duration-200">
      <div
        className="w-full sm:max-w-md h-[85vh] sm:h-[580px] bg-[#1a1a1e] border-t sm:border border-white/10 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#242429] border-b border-white/10 select-none">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-800 flex-shrink-0">
              {peer.image && (
                <ReactSVG src={`data:image/svg+xml;base64,${btoa(peer.image)}`} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm sm:text-base leading-tight">
                  {peer.name}
                </span>
                {peer.isNearby && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">
                    Nearby
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400">Connected</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 p-6 space-y-2">
              <MessageSquare className="w-10 h-10 text-gray-500 opacity-60" />
              <p className="text-sm">No messages yet with {peer.name}.</p>
              <p className="text-xs text-gray-500">
                Messages sent here are delivered directly in real-time.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === "me";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col group ${
                    isMe ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`relative max-w-[80%] rounded-2xl px-3.5 py-2 text-sm break-words shadow-sm ${
                      isMe
                        ? "bg-[#5bb6ff] text-black font-medium rounded-tr-xs"
                        : "bg-[#2d2d34] text-white rounded-tl-xs"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    <button
                      onClick={() => copyText(msg.id, msg.text)}
                      className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-black/40 hover:bg-black/60 text-white ${
                        isMe ? "-left-7" : "-right-7"
                      }`}
                      title="Copy message"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 px-1">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Footer Input */}
        <form
          onSubmit={handleSend}
          className="p-3 bg-[#242429] border-t border-white/10 flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message ${peer.name}...`}
            className="flex-1 bg-[#141416] text-white text-sm px-4 py-2.5 rounded-full border border-white/10 focus:border-[#5bb6ff] focus:outline-none placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 bg-[#5bb6ff] hover:bg-[#49a4ed] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-full transition-all active:scale-95 flex items-center justify-center flex-shrink-0"
            title="Send Message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
