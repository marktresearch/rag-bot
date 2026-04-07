"use client";

import { useMutation, useQuery } from "convex/react";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AskResponse,
  ChatMessage,
  ChatSummary,
  StatusResponse,
} from "@/app/lib/api-types";
import { api } from "@/convex/_generated/api";
import {
  CHAT_READY_CHUNK_THRESHOLD,
  EXISTING_INDEXED_DATASET_MESSAGE,
  STORAGE_LIMIT_REACHED_MESSAGE,
  getErrorMessage,
  isStorageLimitErrorMessage,
} from "@/lib/rag-config";
import ChatLayout from "./ChatLayout";
import DatasetSwitcher from "./DatasetSwitcher";
import { MessageSquareIcon, SendIcon } from "./Icons";
import MessageBubble from "./MessageBubble";
import RightPanel from "./RightPanel";
import Sidebar from "./Sidebar";
import {
  ACTIVE_CHAT_STORAGE_KEY,
  buildStatusPills,
  formatCount,
  formatDatasetStatus,
  getDatasetProgress,
  getProcessedChunkCount,
  isChatEnabled,
} from "./chat-ui";

export default function ChatBox() {
  const [question, setQuestion] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [retrievedChunks, setRetrievedChunks] = useState<AskResponse["chunks"]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const ingestionRequestedRef = useRef(false);
  const debugMode = false;
  const deleteChatMutation = useMutation(api.chat.deleteChat);

  // Fetch active namespace from Convex reactively
  const activeNamespace = useQuery(api.userSettings.getActiveNamespace, {}) ?? "arxiv";

  async function loadStatus() {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const json = (await res.json()) as StatusResponse;
    setStatus(json);
    setWarning((current) =>
      current === STORAGE_LIMIT_REACHED_MESSAGE && !json.system.storageLimited
        ? current
        : json.system.warning
    );
    return json;
  }

  async function loadChats() {
    const res = await fetch("/api/chats", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const json = (await res.json()) as {
      chats: ChatSummary[];
      warning?: string | null;
    };
    setChats(json.chats);
    if (json.warning) {
      setWarning(json.warning);
    }
    return json.chats;
  }

  async function loadChat(chatId: string) {
    setLoadingChat(true);
    try {
      const res = await fetch(`/api/chats/${chatId}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const json = (await res.json()) as {
        chat: ChatSummary;
        messages: ChatMessage[];
      };
      setActiveChatId(chatId);
      setMessages(json.messages);
      setRetrievedChunks([]);
      setSidebarOpen(false);
      return json;
    } finally {
      setLoadingChat(false);
    }
  }

  async function bootstrap() {
    setLoadingInitial(true);
    setError(null);
    try {
      const [statusResult, chatsResult] = await Promise.allSettled([loadStatus(), loadChats()]);

      if (statusResult.status !== "fulfilled") {
        throw statusResult.reason;
      }

      const chatList = chatsResult.status === "fulfilled" ? chatsResult.value : [];

      if (chatsResult.status === "rejected") {
        const message = getErrorMessage(chatsResult.reason);
        if (isStorageLimitErrorMessage(message)) {
          setWarning(STORAGE_LIMIT_REACHED_MESSAGE);
        } else {
          setError(message);
        }
      }

      const storedChatId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY)
          : null;
      const preferredChatId =
        storedChatId && chatList.some((chat) => chat.id === storedChatId)
          ? storedChatId
          : chatList[0]?.id ?? null;

      if (preferredChatId) {
        await loadChat(preferredChatId);
      }
    } catch (caughtError: unknown) {
      const message = getErrorMessage(caughtError);
      if (isStorageLimitErrorMessage(message)) {
        setWarning(STORAGE_LIMIT_REACHED_MESSAGE);
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setLoadingInitial(false);
    }
  }

  useEffect(() => {
    void bootstrap();
    // bootstrap intentionally runs once on mount to hydrate the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch status whenever the active namespace changes
  useEffect(() => {
    if (!loadingInitial && activeNamespace) {
      void loadStatus().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNamespace]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    setRightPanelOpen(mediaQuery.matches);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (activeChatId) {
      window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeChatId);
      return;
    }

    window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
  }, [activeChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (loadingInitial) {
      return;
    }

    if (status?.index.hasDocuments || status?.dataset?.status === "failed") {
      return;
    }

    const interval = window.setInterval(() => {
      void loadStatus()
        .then(() => {
          setError(null);
        })
        .catch((caughtError: unknown) => {
          const message = getErrorMessage(caughtError);
          if (isStorageLimitErrorMessage(message)) {
            setWarning(STORAGE_LIMIT_REACHED_MESSAGE);
            setError(null);
            return;
          }
          setError(message);
        });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadingInitial, status?.dataset?.status, status?.index.hasDocuments]);

  useEffect(() => {
    if (loadingInitial || ingestionRequestedRef.current) {
      return;
    }

    if (!status?.dataset || status.dataset.status === "ready" || status.dataset.status === "failed") {
      return;
    }

    ingestionRequestedRef.current = true;

    void fetch("/api/dataset/ensure", {
      method: "POST",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
      })
      .then(() => loadStatus().catch(() => undefined))
      .catch((caughtError: unknown) => {
        ingestionRequestedRef.current = false;
        setError(getErrorMessage(caughtError));
      });
  }, [loadingInitial, status?.dataset]);

  function mergeResponseState(data: {
    chatId?: string | null;
    system?: AskResponse["system"] | null;
    dataset?: AskResponse["dataset"] | null;
  }) {
    if (data.system) {
      setWarning(data.system.warning);
    }
    if (data.chatId) {
      setActiveChatId(data.chatId);
    }
    if (data.system || data.dataset) {
      setStatus((current) =>
        current
          ? {
              ...current,
              dataset: data.dataset ?? current.dataset,
              system: data.system
                ? {
                    ...current.system,
                    ...data.system,
                  }
                : current.system,
            }
          : current
      );
    }
  }

  function updateAssistantMessage(
    assistantId: string,
    updater: (message: ChatMessage) => ChatMessage
  ) {
    setMessages((current) =>
      current.map((message) => (message.id === assistantId ? updater(message) : message))
    );
  }

  function parseStreamEvent(block: string) {
    const lines = block.split("\n");
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    return {
      event,
      data: JSON.parse(dataLines.join("\n")) as unknown,
    };
  }

  async function handleAsk() {
    const trimmed = question.trim();
    const chatReady = isChatEnabled(status);
    if (!trimmed || sending || !chatReady) {
      return;
    }

    setSending(true);
    setError(null);
    setQuestion("");
    setRetrievedChunks([]);

    const optimisticUser: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
      route: null,
      metadata: null,
    };

    const assistantId = crypto.randomUUID();
    setPendingAssistantId(assistantId);
    setMessages((current) => [
      ...current,
      optimisticUser,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        route: null,
        metadata: null,
      },
    ]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          chatId: activeChatId,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; warning?: string | null }
          | null;
        if (payload?.warning) {
          setWarning(payload.warning);
        }
        throw new Error(payload?.error ?? "Failed to generate an answer.");
      }
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("The response stream was unavailable.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: AskResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary < 0) {
            break;
          }

          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseStreamEvent(block);
          if (!parsed) {
            continue;
          }

          if (parsed.event === "meta") {
            mergeResponseState(parsed.data as Parameters<typeof mergeResponseState>[0]);
            continue;
          }

          if (parsed.event === "delta") {
            const content =
              typeof (parsed.data as { content?: unknown }).content === "string"
                ? ((parsed.data as { content: string }).content ?? "")
                : "";
            if (content) {
              updateAssistantMessage(assistantId, (message) => ({
                ...message,
                content: `${message.content}${content}`,
              }));
            }
            continue;
          }

          if (parsed.event === "done") {
            finalResponse = parsed.data as AskResponse;
            mergeResponseState(finalResponse);
            setRetrievedChunks(finalResponse.chunks ?? []);
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content: finalResponse?.answer ?? message.content,
              route: finalResponse?.route ?? message.route,
              metadata: finalResponse
                ? {
                    matches: finalResponse.matches,
                    metrics: finalResponse.metrics,
                    routingReason: finalResponse.routingReason,
                  }
                : message.metadata,
            }));
            continue;
          }

          if (parsed.event === "error") {
            const message =
              typeof (parsed.data as { message?: unknown }).message === "string"
                ? (parsed.data as { message: string }).message
                : "Failed to generate an answer.";
            throw new Error(message);
          }
        }
      }

      if (!finalResponse) {
        throw new Error("The answer stream ended before completion.");
      }

      const completedChatId = finalResponse.chatId;
      const shouldReloadPersistedChat =
        finalResponse.system.persisted && Boolean(completedChatId);
      setPendingAssistantId(null);
      startTransition(() => {
        if (shouldReloadPersistedChat && completedChatId) {
          void Promise.all([loadChats(), loadChat(completedChatId), loadStatus()]);
          return;
        }

        void loadStatus().catch(() => undefined);
      });
    } catch (caughtError: unknown) {
      const message = getErrorMessage(caughtError);
      if (isStorageLimitErrorMessage(message)) {
        setWarning(STORAGE_LIMIT_REACHED_MESSAGE);
      }
      setError(message);
      setPendingAssistantId(null);
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content: "I hit an error while generating that answer.",
              }
            : entry
        )
      );
    } finally {
      setSending(false);
    }
  }

  async function handleNewChat() {
    setError(null);
    setActiveChatId(null);
    setMessages([]);
    setRetrievedChunks([]);
    setSidebarOpen(false);
  }

  async function handleSelectChat(chatId: string) {
    if (chatId === activeChatId || loadingChat) {
      setSidebarOpen(false);
      return;
    }
    try {
      setError(null);
      await loadChat(chatId);
    } catch (caughtError: unknown) {
      const message = getErrorMessage(caughtError);
      setError(message);
    }
  }

  async function handleDeleteChat(chatId: string) {
    if (deletingChatId || loadingChat) {
      return;
    }

    if (sending && chatId === activeChatId) {
      setError("Wait for the current response to finish before deleting this chat.");
      return;
    }

    const deletingActiveChat = chatId === activeChatId;
    const remainingChats = chats.filter((chat) => chat.id !== chatId);
    let deleteSucceeded = false;
    setDeletingChatId(chatId);
    setError(null);

    if (deletingActiveChat) {
      setActiveChatId(null);
      setMessages([]);
      setRetrievedChunks([]);
    }

    try {
      await deleteChatMutation({ chatId });
      deleteSucceeded = true;
      setChats(remainingChats);
      const updatedChats = await loadChats().catch(() => remainingChats);

      if (deletingActiveChat) {
        const nextChatId = updatedChats[0]?.id ?? null;
        if (nextChatId) {
          await loadChat(nextChatId);
        } else {
          setActiveChatId(null);
          setMessages([]);
          setRetrievedChunks([]);
          setSidebarOpen(false);
        }
      }
    } catch (caughtError: unknown) {
      if (deletingActiveChat && !deleteSucceeded) {
        await loadChat(chatId).catch(() => undefined);
      }

      setError(getErrorMessage(caughtError));
    } finally {
      setDeletingChatId(null);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleAsk();
    }
  }

  function handleNamespaceChange() {
    // Re-fetch status when namespace changes (Convex reactive query auto-updates activeNamespace)
    void loadStatus().catch(() => undefined);
  }

  const dataset = status?.dataset ?? null;
  const datasetState = formatDatasetStatus(dataset, status?.index.hasDocuments);
  const datasetProgress = getDatasetProgress(dataset);
  const processedChunks = getProcessedChunkCount(dataset);
  const indexedDocumentCount = status?.index.documentCount ?? processedChunks;
  const queuedChunkCount = dataset?.queuedChunkCount ?? 0;
  const chatReady = isChatEnabled(status);
  const datasetReady = chatReady;
  const datasetFailed = datasetState === "Failed";
  const usingExistingIndex = status?.system.usingExistingIndex ?? false;
  const storageLimited = status?.system.storageLimited ?? false;
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant") ?? null;
  const title = activeChat?.title ?? "New conversation";
  const statusPills = buildStatusPills(status, latestAssistantMessage);
  const composerHint = sending
    ? "Generating response..."
    : datasetFailed
      ? "Dataset ingestion failed."
      : storageLimited
        ? STORAGE_LIMIT_REACHED_MESSAGE
        : usingExistingIndex
          ? EXISTING_INDEXED_DATASET_MESSAGE
          : chatReady
            ? "Enter to send. Shift+Enter for a new line. Ingestion can continue while you chat."
            : queuedChunkCount > 0
              ? `${queuedChunkCount.toLocaleString()} chunks are still ingesting. Chat unlocks after more than ${CHAT_READY_CHUNK_THRESHOLD} chunks are ready.`
              : `No indexed dataset is available yet. Chat unlocks after more than ${CHAT_READY_CHUNK_THRESHOLD} chunks are ready.`;
  const composerPlaceholder = datasetFailed
    ? "Dataset ingestion failed. Fix the dataset configuration and try again."
    : chatReady
      ? "Ask about the dataset, the indexed docs, or continue the conversation..."
      : "Waiting for indexed documents to become available...";

  return (
    <ChatLayout
      title={title}
      statusLine={[
        <DatasetSwitcher
          key="dataset-switcher"
          activeNamespace={activeNamespace}
          onNamespaceChange={handleNamespaceChange}
        />,
        ...statusPills.map((pill) => (
          <span
            key={pill.label}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${pill.tone}`}
          >
            {pill.dotTone ? <span className={`h-2 w-2 rounded-full ${pill.dotTone}`} /> : null}
            <span>{pill.label}</span>
          </span>
        )),
      ]}
      sidebar={
        <Sidebar
          activeChatId={activeChatId}
          chats={chats}
          deletingChatId={deletingChatId}
          loadingChat={loadingChat}
          onDeleteChat={handleDeleteChat}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
        />
      }
      mobileSidebar={
        <Sidebar
          activeChatId={activeChatId}
          chats={chats}
          deletingChatId={deletingChatId}
          loadingChat={loadingChat}
          onClose={() => setSidebarOpen(false)}
          onDeleteChat={handleDeleteChat}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
        />
      }
      rightPanel={
        <RightPanel
          dataset={dataset}
          retrievedChunks={retrievedChunks}
          activeNamespace={activeNamespace}
        />
      }
      mobileRightPanel={
        <RightPanel
          dataset={dataset}
          onClose={() => setRightPanelOpen(false)}
          retrievedChunks={retrievedChunks}
          activeNamespace={activeNamespace}
        />
      }
      sidebarOpen={sidebarOpen}
      rightPanelOpen={rightPanelOpen}
      onSidebarOpen={() => {
        setRightPanelOpen(false);
        setSidebarOpen(true);
      }}
      onSidebarClose={() => setSidebarOpen(false)}
      onRightPanelOpen={() => {
        setSidebarOpen(false);
        setRightPanelOpen(true);
      }}
      onRightPanelClose={() => setRightPanelOpen(false)}
      composer={
        <div className="space-y-4">
          {!chatReady ? (
            <div className="rounded-[28px] border border-white/10 bg-[#0B1118] px-5 py-4">
              <div className="flex items-center justify-between gap-4 text-[14px] text-slate-300">
                <span>{datasetFailed ? "Dataset state" : "Index status"}</span>
                <span>{datasetFailed ? "Failed" : `${datasetProgress}%`}</span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-all duration-500"
                  style={{ width: `${Math.max(datasetProgress, dataset ? 4 : 0)}%` }}
                />
              </div>
              <p className="mt-3 text-[13px] text-slate-400">
                {indexedDocumentCount > 0 || queuedChunkCount <= 0
                  ? `${formatCount(indexedDocumentCount)} indexed chunks`
                  : `${formatCount(queuedChunkCount)} queued chunks`}
              </p>
              {datasetFailed && dataset?.errorMessage ? (
                <p className="mt-3 text-[13px] leading-6 text-rose-300">{dataset.errorMessage}</p>
              ) : null}
            </div>
          ) : null}

          {warning ? (
            <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-300/10 px-5 py-4 text-[14px] text-cyan-50">
              {warning}
            </div>
          ) : null}

          <div className="rounded-[28px] border border-white/10 bg-[#0B1118] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <textarea
              className="min-h-[108px] w-full resize-none rounded-[22px] border border-white/10 bg-white/[0.02] px-4 py-4 text-[14px] leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/30"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={composerPlaceholder}
              value={question}
            />

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <span
                  className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${
                    chatReady
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                      : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      chatReady ? "bg-emerald-300" : "bg-amber-300"
                    }`}
                  />
                  <span>{chatReady ? "RAG active" : "RAG indexing"}</span>
                </span>
                <div className="text-[13px] text-slate-400">{composerHint}</div>
              </div>

              <button
                aria-label="Send message"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300 text-[#0B0F14] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-slate-500"
                disabled={sending || question.trim().length === 0 || !chatReady}
                onClick={() => void handleAsk()}
                type="button"
              >
                <SendIcon size={16} />
              </button>
            </div>
          </div>

          {error && !isStorageLimitErrorMessage(error) ? (
            <div className="text-[14px] text-rose-300">{error}</div>
          ) : null}
        </div>
      }
    >
      {loadingInitial ? (
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-[28px] border border-white/5 bg-white/[0.03]" />
          <div className="h-36 animate-pulse rounded-[28px] border border-white/5 bg-white/[0.03]" />
          <div className="h-28 animate-pulse rounded-[28px] border border-white/5 bg-white/[0.03]" />
        </div>
      ) : messages.length === 0 && !activeChatId ? (
        <div className="flex min-h-full items-center justify-center">
          <div className="flex flex-col items-center justify-center gap-4 text-slate-500">
            <MessageSquareIcon className="opacity-20" size={48} />
            <p className="text-lg font-medium opacity-50">No conversation selected</p>
            <button
              className="rounded-lg bg-cyan-300 px-4 py-2 text-sm text-[#0B0F14] transition hover:opacity-90"
              onClick={() => void handleNewChat()}
              type="button"
            >
              Start a new chat
            </button>
          </div>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex min-h-full items-center justify-center">
          <div className="max-w-2xl rounded-[28px] border border-dashed border-white/10 px-8 py-10 text-center">
            <h2 className="text-[18px] font-semibold text-white">
              {datasetReady
                ? "Start a conversation"
                : datasetFailed
                  ? "Dataset ingestion failed"
                  : "No indexed dataset yet"}
            </h2>
            <p className="mt-3 text-[14px] leading-7 text-slate-400">
              {datasetReady
                ? `${warning ?? EXISTING_INDEXED_DATASET_MESSAGE}. ${formatCount(indexedDocumentCount)} indexed chunks are available for retrieval.`
                : datasetFailed
                  ? dataset?.errorMessage ??
                    "Dataset preparation failed. Fix the dataset configuration and try again."
                  : queuedChunkCount > 0
                    ? `${datasetProgress}% of the ${dataset?.datasetName ?? "dataset"} index is ready so far. ${formatCount(queuedChunkCount)} chunks are queued in Convex and chat will start using them as soon as the first chunks become queryable.`
                    : `${datasetProgress}% of the ${dataset?.datasetName ?? "dataset"} index is available so far. Chat will start using the corpus as soon as indexed chunks exist.`}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              debugMode={debugMode}
              message={message}
              pending={message.id === pendingAssistantId}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </ChatLayout>
  );
}
