"use client";

import { useState } from "react";
import type { ChatMessage } from "@/app/lib/api-types";
import MarkdownContent from "./MarkdownContent";
import { ChevronDownIcon, ChevronUpIcon, FileIcon } from "./Icons";
import { formatMessageTime, formatRouteLabel } from "./chat-ui";

type MessageBubbleProps = {
  message: ChatMessage;
  pending?: boolean;
  debugMode: boolean;
};

function formatTokenLine(label: string, value: number | null | undefined) {
  if (!value || value <= 0) {
    return null;
  }

  return `${label} ${value.toLocaleString()}`;
}

function parseAssistantMessage(content: string) {
  const sourceIdx = content.indexOf("Source:");
  const chunksIdx = content.indexOf("Supporting chunks:");

  const answer = sourceIdx > 0 ? content.slice(0, sourceIdx).trim() : content.trim();
  const source =
    sourceIdx > 0 && chunksIdx > 0
      ? content.slice(sourceIdx, chunksIdx).trim()
      : sourceIdx > 0
        ? content.slice(sourceIdx).trim()
        : "";
  const chunks = chunksIdx > 0 ? content.slice(chunksIdx).trim() : "";

  return { answer, source, chunks };
}

function formatSourceName(source: string) {
  const normalized = source.trim();
  if (!normalized) {
    return "Unknown source";
  }

  const filename = normalized.split("/").pop();
  return filename && filename.length > 0 ? filename : normalized;
}

function formatSourceLine(source: string) {
  const normalized = source.replace(/^Source:\s*/, "").trim();
  if (!normalized) {
    return "";
  }

  return Array.from(
    new Set(
      normalized
        .split("|")
        .map((part) => formatSourceName(part))
        .filter(Boolean)
    )
  ).join(" | ");
}

function splitSupportingChunks(chunks: string) {
  const normalized = chunks.replace(/^Supporting chunks:\s*/, "").trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n(?=\[\d+\])/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function MessageBubble({
  message,
  pending = false,
  debugMode,
}: MessageBubbleProps) {
  const [showDebugDetails, setShowDebugDetails] = useState(false);
  const [showChunks, setShowChunks] = useState(false);

  const isAssistant = message.role === "assistant";
  const isUser = message.role === "user";
  const matches = message.metadata?.matches ?? [];
  const metrics = message.metadata?.metrics ?? null;
  const routingReason = message.metadata?.routingReason ?? null;
  const hasDebugDetails =
    Boolean(message.route) || Boolean(routingReason) || Boolean(metrics) || matches.length > 0;
  const isTyping = isAssistant && pending && message.content.length === 0;
  const parsedAssistantMessage = isAssistant ? parseAssistantMessage(message.content) : null;
  const supportingChunks = parsedAssistantMessage
    ? splitSupportingChunks(parsedAssistantMessage.chunks)
    : [];

  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-4 text-[14px] text-slate-300">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <article
        className={`w-full ${
          isUser
            ? "max-w-2xl rounded-[24px] border border-cyan-300/20 bg-cyan-300/12 px-5 py-4"
            : "max-w-3xl border-l-2 border-cyan-300/70 pl-5 py-1"
        }`}
      >
        <div className="flex items-center justify-between gap-4 text-[13px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{isUser ? "You" : "Assistant"}</span>
            {isAssistant && metrics?.latencyMs ? (
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
                {metrics.latencyMs}ms
              </span>
            ) : null}
          </div>
          <span className="text-[11px] text-slate-500 opacity-0 transition group-hover:opacity-100">
            {formatMessageTime(message.createdAt)}
          </span>
        </div>

        <div className="mt-3 text-[14px] leading-7 text-slate-100">
          {isTyping ? (
            <div className="flex items-center gap-2 py-1">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:120ms]" />
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:240ms]" />
            </div>
          ) : isAssistant ? (
            <div className="space-y-3">
              {parsedAssistantMessage?.answer ? (
                <MarkdownContent content={parsedAssistantMessage.answer} />
              ) : null}

              {parsedAssistantMessage?.source ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <FileIcon size={12} />
                  <span>{formatSourceLine(parsedAssistantMessage.source)}</span>
                </div>
              ) : null}

              {supportingChunks.length > 0 ? (
                <div>
                  <button
                    className="flex items-center gap-1 text-[12px] text-slate-500 transition-colors hover:text-slate-300"
                    onClick={() => setShowChunks((current) => !current)}
                    type="button"
                  >
                    {showChunks ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                    <span>
                      {showChunks ? "Hide" : "Show"} supporting chunks ({supportingChunks.length})
                    </span>
                  </button>
                  {showChunks ? (
                    <div className="mt-2 space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-[12px] leading-6 text-slate-400">
                      {supportingChunks.map((chunk, index) => (
                        <div
                          key={`${message.id}-chunk-${index}`}
                          className={index > 0 ? "border-t border-white/10 pt-2" : undefined}
                        >
                          <div className="whitespace-pre-wrap">{chunk}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="whitespace-pre-wrap">{message.content}</div>
          )}
        </div>

        {debugMode && hasDebugDetails ? (
          <div className="mt-4 border-t border-white/10 pt-4">
            <button
              className="text-[14px] font-medium text-cyan-200 transition hover:text-cyan-100"
              onClick={() => setShowDebugDetails((current) => !current)}
              type="button"
            >
              {showDebugDetails ? "Hide debug details" : "Show debug details"}
            </button>

            {showDebugDetails ? (
              <div className="mt-4 space-y-4 text-[14px] text-slate-300">
                {message.route ? (
                  <div>
                    <div className="text-slate-500">Route</div>
                    <div className="mt-1 text-white">{formatRouteLabel(message.route)}</div>
                  </div>
                ) : null}

                {routingReason ? (
                  <div>
                    <div className="text-slate-500">Reason</div>
                    <div className="mt-1">{routingReason}</div>
                  </div>
                ) : null}

                {metrics ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1">
                      {metrics.latencyMs}ms
                    </span>
                    {formatTokenLine("Prompt", metrics.promptTokens) ? (
                      <span className="rounded-full border border-white/10 px-3 py-1">
                        {formatTokenLine("Prompt", metrics.promptTokens)}
                      </span>
                    ) : null}
                    {formatTokenLine("Completion", metrics.completionTokens) ? (
                      <span className="rounded-full border border-white/10 px-3 py-1">
                        {formatTokenLine("Completion", metrics.completionTokens)}
                      </span>
                    ) : null}
                    {formatTokenLine("Total", metrics.totalTokens) ? (
                      <span className="rounded-full border border-white/10 px-3 py-1">
                        {formatTokenLine("Total", metrics.totalTokens)}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {matches.length > 0 ? (
                  <div className="space-y-3">
                    {matches.map((match) => (
                      <div
                        key={`${message.id}-${match.id}-${match.rank}`}
                        className="rounded-3xl border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[14px] text-slate-400">
                          <span className="font-medium text-white">#{match.rank}</span>
                          <span>{Math.round(match.confidence * 100)}% confidence</span>
                          <span>{match.title ?? match.source}</span>
                        </div>
                        <div className="mt-3 whitespace-pre-wrap text-slate-200">{match.text}</div>
                        {match.url ? (
                          <a
                            className="mt-3 inline-flex text-[14px] text-cyan-200 underline decoration-cyan-800 underline-offset-4 hover:text-cyan-100"
                            href={match.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open source
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </div>
  );
}
