"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { DatasetInfo, RetrievedChunk } from "@/app/lib/api-types";
import { DEFAULT_NAMESPACE } from "@/app/lib/dataset-config";
import { api } from "@/convex/_generated/api";
import { formatCount } from "./chat-ui";

/* ──────────────────── types ──────────────────── */

type RightPanelTab = "hallucination" | "chunks" | "accuracy";

type RightPanelProps = {
  dataset: DatasetInfo | null;
  retrievedChunks: RetrievedChunk[];
  activeNamespace?: string;
  onClose?: () => void;
};

/* ──────────────────── helpers ──────────────────── */

const GROUNDING_THRESHOLD = 0.35;
const WELL_GROUNDED_THRESHOLD = 0.5;

function fmtPct(v: number) {
  return `${v.toFixed(1)}%`;
}

function fmtSim(v: number) {
  return v.toFixed(3);
}

function fmtSim2(v: number) {
  return v.toFixed(2);
}

function formatSourceName(source: string) {
  const s = source.trim();
  if (!s) return "Unknown PDF";
  const pieces = s.split("/");
  return pieces[pieces.length - 1] ?? s;
}

function scorePillTone(score: number) {
  if (score >= WELL_GROUNDED_THRESHOLD)
    return "bg-emerald-500/20 text-emerald-400";
  if (score >= GROUNDING_THRESHOLD) return "bg-amber-500/20 text-amber-400";
  return "bg-rose-500/20 text-rose-400";
}

function segPct(v: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((v / total) * 100);
}

/* ──────────────────── accuracy inline data ──────────────────── */

const ACCURACY_MINI_ROWS = [
  { label: "Parser", old: "None", new: "LiteParse" },
  { label: "Dataset", old: "JSONL", new: "arXiv PDFs" },
  { label: "Embedding", old: "Gemini (paid)", new: "Ollama (free)" },
  { label: "DB size", old: "5.5 GB", new: "320 MB" },
  { label: "Chunks", old: "86,000+", new: "~6,000" },
  { label: "Latency", old: "6–9s", new: "~1.8s" },
] as const;

/* ──────────────────── component ──────────────────── */

export default function RightPanel({
  dataset,
  retrievedChunks,
  activeNamespace,
  onClose,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>("hallucination");
  const hallucination = useQuery(api.queryLogs.getHallucinationDashboard, {});
  const chunkDashboard = useQuery(api.datasets.getChunkDashboard, {
    namespace: activeNamespace ?? DEFAULT_NAMESPACE,
  });

  const totalChunkCount =
    chunkDashboard?.totalChunkCount ?? dataset?.processedChunks ?? 0;

  /* hallucination breakdown percentages */
  const bkFull = hallucination?.breakdown.fullyGrounded ?? 0;
  const bkPartial = hallucination?.breakdown.partiallyGrounded ?? 0;
  const bkHalluc = hallucination?.breakdown.hallucinated ?? 0;
  const bkTotal = bkFull + bkPartial + bkHalluc;

  const tabs: { key: RightPanelTab; label: string }[] = [
    { key: "hallucination", label: "Hallucination" },
    { key: "chunks", label: "Chunks" },
    { key: "accuracy", label: "Accuracy" },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* ── Fixed header ── */}
      <div className="flex-shrink-0 px-3 pt-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-white">
            RAG Dashboards
          </h2>
          {onClose ? (
            <button
              className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[12px] text-slate-300 transition hover:bg-white/[0.06]"
              onClick={onClose}
              type="button"
            >
              Hide
            </button>
          ) : null}
        </div>
        {/* Active namespace indicator */}
        <div className="mt-1 truncate text-[10px] text-slate-500">
          Namespace: <span className="text-cyan-400">{activeNamespace ?? DEFAULT_NAMESPACE}</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        <div className="flex gap-1 rounded-xl bg-white/5 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-white text-black shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-y-auto">
        {/* ────── HALLUCINATION TAB ────── */}
        {activeTab === "hallucination" ? (
          <div>
            {/* 2x2 metric pills */}
            <div className="grid grid-cols-2 gap-2 p-3">
              <div className="flex flex-col gap-1 rounded-xl bg-white/5 p-3">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Hallucination
                </span>
                <span className="text-2xl font-bold text-red-400">
                  {fmtPct(hallucination?.hallucinationRate ?? 0)}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-xl bg-white/5 p-3">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Grounded
                </span>
                <span className="text-2xl font-bold text-green-400">
                  {fmtPct(hallucination?.groundedRate ?? 0)}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-xl bg-white/5 p-3">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Avg Similarity
                </span>
                <span className="text-2xl font-bold text-blue-400">
                  {fmtSim(hallucination?.avgSimilarity ?? 0)}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-xl bg-white/5 p-3">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Queries
                </span>
                <span className="text-2xl font-bold text-white">
                  {formatCount(
                    hallucination?.total ?? hallucination?.totalQueries ?? 0
                  )}
                </span>
              </div>
            </div>

            {/* Grounding breakdown bar */}
            <div className="px-3 pb-3">
              <div className="mb-1 flex justify-between text-[10px] text-gray-500">
                <span>Grounding breakdown</span>
                <span>threshold: 0.35</span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="bg-green-500"
                  style={{ width: `${segPct(bkFull, bkTotal)}%` }}
                />
                <div
                  className="bg-amber-500"
                  style={{ width: `${segPct(bkPartial, bkTotal)}%` }}
                />
                <div
                  className="bg-red-500"
                  style={{ width: `${segPct(bkHalluc, bkTotal)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px]">
                <span className="text-green-400">
                  ✓ {segPct(bkFull, bkTotal)}%
                </span>
                <span className="text-amber-400">
                  ~ {segPct(bkPartial, bkTotal)}%
                </span>
                <span className="text-red-400">
                  ✗ {segPct(bkHalluc, bkTotal)}%
                </span>
              </div>
            </div>

            {/* Recent queries — compact list */}
            <div className="px-3 pb-3">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">
                Recent queries
              </p>
              <div className="space-y-1">
                {(hallucination?.recentLogs ?? []).length > 0 ? (
                  hallucination?.recentLogs.slice(0, 5).map((log) => (
                    <div
                      key={`${log.timestamp}:${log.query}`}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1.5"
                    >
                      <span className="flex-1 truncate text-xs text-gray-300">
                        {log.query}
                      </span>
                      <span
                        className={`flex-shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${scorePillTone(log.topChunkSimilarity)}`}
                      >
                        {fmtSim2(log.topChunkSimilarity)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-[12px] text-slate-500">
                    Logs appear after the first retrieval query.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ────── CHUNKS TAB ────── */}
        {activeTab === "chunks" ? (
          <div className="space-y-3 p-3">
            {/* Single stat */}
            <div className="flex items-center justify-between rounded-xl bg-white/5 p-3">
              <span className="text-xs text-gray-400">Indexed chunks</span>
              <span className="text-2xl font-bold text-white">
                {formatCount(totalChunkCount)}
              </span>
            </div>

            {/* Last query chunks */}
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">
                Last query — top chunks
              </p>
              <div className="space-y-1">
                {retrievedChunks.length > 0 ? (
                  retrievedChunks.slice(0, 3).map((chunk) => (
                    <div
                      key={chunk.id}
                      className="rounded-lg border border-white/5 bg-white/5 p-2"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="truncate text-[10px] text-gray-500">
                          {formatSourceName(chunk.source)}
                        </span>
                        <span
                          className={`ml-1 flex-shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${scorePillTone(chunk.score)}`}
                        >
                          {fmtSim(chunk.score)}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[11px] text-gray-400">
                        {chunk.text.slice(0, 120)}…
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[12px] text-slate-500">
                    Ask a question to see retrieved chunks.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ────── ACCURACY TAB ────── */}
        {activeTab === "accuracy" ? (
          <div className="space-y-3 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Before vs After LiteParse
            </p>

            {/* 4 improvement pills */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-2 text-center">
                <div className="text-lg font-bold text-green-400">94%</div>
                <div className="text-[10px] text-gray-400">
                  less DB storage
                </div>
              </div>
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-2 text-center">
                <div className="text-lg font-bold text-green-400">80%</div>
                <div className="text-[10px] text-gray-400">faster latency</div>
              </div>
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-2 text-center">
                <div className="text-lg font-bold text-green-400">↓14%</div>
                <div className="text-[10px] text-gray-400">hallucination</div>
              </div>
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-2 text-center">
                <div className="text-lg font-bold text-green-400">$0</div>
                <div className="text-[10px] text-gray-400">API cost</div>
              </div>
            </div>

            {/* Mini comparison table */}
            <div className="space-y-1">
              {ACCURACY_MINI_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center border-b border-white/5 py-1 text-[11px]"
                >
                  <span className="w-20 flex-shrink-0 text-gray-500">
                    {row.label}
                  </span>
                  <span className="flex-1 text-center text-red-400/70 line-through">
                    {row.old}
                  </span>
                  <span className="flex-1 text-right text-green-400">
                    {row.new}
                  </span>
                </div>
              ))}
            </div>

            {/* Link to full page */}
            <Link
              href="/accuracy"
              className="block rounded-lg border border-blue-500/20 py-2 text-center text-xs text-blue-400 transition-all hover:bg-blue-500/10 hover:text-blue-300"
            >
              View full comparison →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
