import type { ChatMessage } from "@/app/lib/api-types";
import MarkdownContent from "./MarkdownContent";

type Props = {
  message: ChatMessage;
  pending?: boolean;
};

function formatTokens(value: number | null | undefined) {
  if (!value || value <= 0) {
    return null;
  }
  return `${value.toLocaleString()} tokens`;
}

export default function ResultCard({ message, pending = false }: Props) {
  const matches = message.metadata?.matches ?? [];
  const metrics = message.metadata?.metrics ?? null;
  const routingReason = message.metadata?.routingReason ?? null;
  const isTyping = pending && message.content.length === 0;

  return (
    <article className="rounded-[28px] border border-slate-800/80 bg-slate-900/80 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">
          Assistant
        </span>
        {message.route && (
          <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-slate-300">
            {message.route.replace("_", " ")}
          </span>
        )}
        {routingReason && (
          <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-slate-400">
            {routingReason}
          </span>
        )}
        {metrics && (
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
            {metrics.latencyMs} ms
          </span>
        )}
      </div>

      {isTyping ? (
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:120ms]" />
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:240ms]" />
        </div>
      ) : (
        <MarkdownContent content={message.content} />
      )}

      {(metrics || matches.length > 0) && (
        <div className="mt-5 space-y-4 border-t border-slate-800 pt-4">
          {metrics && (
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1">
                Latency {metrics.latencyMs} ms
              </span>
              {formatTokens(metrics.promptTokens) && (
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1">
                  Prompt {formatTokens(metrics.promptTokens)}
                </span>
              )}
              {formatTokens(metrics.completionTokens) && (
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1">
                  Completion {formatTokens(metrics.completionTokens)}
                </span>
              )}
              {formatTokens(metrics.totalTokens) && (
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1">
                  Total {formatTokens(metrics.totalTokens)}
                </span>
              )}
            </div>
          )}

          {matches.length > 0 && (
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Retrieved Chunks
              </div>
              <div className="space-y-3">
                {matches.map((match) => (
                  <div
                    key={`${message.id}-${match.id}-${match.rank}`}
                    className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="rounded-full border border-slate-700 px-2.5 py-1 text-slate-300">
                        #{match.rank}
                      </span>
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-cyan-200">
                        {Math.round(match.confidence * 100)}% confidence
                      </span>
                      <span>{match.source}</span>
                      {match.title && <span>{match.title}</span>}
                      {match.path && <span>{match.path}</span>}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                      {match.text}
                    </div>
                    {match.url && (
                      <a
                        className="mt-3 inline-flex text-xs text-cyan-300 underline decoration-cyan-700 underline-offset-4 hover:text-cyan-200"
                        href={match.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
