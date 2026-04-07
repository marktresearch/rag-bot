"use client";

import type { ChatSummary } from "@/app/lib/api-types";
import { TrashIcon } from "./Icons";

type SidebarProps = {
  chats: ChatSummary[];
  activeChatId: string | null;
  loadingChat: boolean;
  deletingChatId?: string | null;
  onNewChat: () => void | Promise<void>;
  onSelectChat: (chatId: string) => void | Promise<void>;
  onDeleteChat: (chatId: string) => void | Promise<void>;
  onClose?: () => void;
};

function truncateChatTitle(title: string) {
  const cleaned = title.replace(/\s+/g, " ").trim() || "New conversation";
  return cleaned.length <= 20 ? cleaned : `${cleaned.slice(0, 20).trimEnd()}...`;
}

export default function Sidebar({
  chats,
  activeChatId,
  loadingChat,
  deletingChatId = null,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onClose,
}: SidebarProps) {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold text-white">Chats</h2>
          <p className="mt-2 text-[12px] uppercase tracking-[0.18em] text-slate-500">
            {loadingChat ? "Loading conversation..." : "Recent conversations"}
          </p>
        </div>
        {onClose ? (
          <button
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[14px] text-slate-200 transition hover:bg-white/[0.06]"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        ) : null}
      </div>

      <button
        className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-left text-[14px] font-medium text-cyan-50 transition hover:border-cyan-300/30 hover:bg-cyan-400/14"
        onClick={() => void onNewChat()}
        type="button"
      >
        New Chat
      </button>

      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
          Recent conversations
        </p>
      </div>

      <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
        {chats.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/10 px-4 py-5 text-[14px] text-slate-400">
            No chats yet.
          </div>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isDeleting = deletingChatId === chat.id;

            return (
              <div
                key={chat.id}
                className={`group relative flex items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] transition ${
                  isActive
                    ? "border-l-[2.5px] border-l-cyan-300 bg-white/[0.05] text-white"
                    : "border-l-[2.5px] border-l-transparent text-slate-300 hover:bg-white/[0.04]"
                }`}
              >
                <button
                  className="flex-1 truncate px-4 py-3 pr-10 text-left text-[14px] transition"
                  disabled={isDeleting}
                  onClick={() => void onSelectChat(chat.id)}
                  title={chat.title}
                  type="button"
                >
                  <span className="block truncate font-medium">{truncateChatTitle(chat.title)}</span>
                </button>
                <button
                  aria-label={`Delete ${chat.title}`}
                  className="absolute right-2 rounded-lg p-1 text-slate-500 opacity-0 transition-all hover:bg-rose-400/15 hover:text-rose-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={isDeleting}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDeleteChat(chat.id);
                  }}
                  type="button"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
