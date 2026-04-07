import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accuracy & Ingestion Comparison | Spinabot RAG",
  description:
    "Before vs After comparison of the RAG pipeline: from OpenWebText + Gemini to LiteParse + arXiv.",
};

/* ──────────────────── data ──────────────────── */


const PERFORMANCE_METRICS = [
  {
    category: "Efficiency Improvements",
    description: "Lower is better for structural metrics.",
    items: [
      { id: "storage", title: "Storage", oldVal: "5.5GB", newVal: "320MB", oldPct: 100, newPct: 6, delta: "94% Less" },
      { id: "latency", title: "Wait Time", oldVal: "7.5s", newVal: "1.8s", oldPct: 100, newPct: 24, delta: "76% Faster" },
      { id: "chunks", title: "Total Chunks", sub: "(from 1GB)", oldVal: "86K", newVal: "6K", oldPct: 100, newPct: 7, delta: "93% Fewer" },
    ]
  },
  {
    category: "Accuracy & Quality",
    description: "Higher similarity and operational retrieval efficiency.",
    items: [
      { id: "similarity", title: "Similarity", oldVal: "0.18", newVal: "0.35", oldPct: 51, newPct: 100 },
      { id: "hallucination", title: "Hallucinations", oldVal: "42%", newVal: "<2%", oldPct: 84, newPct: 4, delta: "95% Lower" },
      { id: "retrieval", title: "Retrieval", sub: "Efficiency", oldVal: "Poor", newVal: "High", oldPct: 20, newPct: 95 },
    ]
  }
];


const PIPELINE_STEPS = [
  { label: "Download PDFs" },
  { label: "LiteParse extracts text" },
  { label: "Chunk with overlap" },
  { label: "Embed chunks" },
  { label: "Store in Convex RAG" },
  { label: "Ready to query" },
] as const;

/* ──────────────────── page ──────────────────── */

export default function AccuracyPage() {
  return (
    <div className="min-h-screen bg-[#0B0F14] text-slate-100">
      {/* Subtle radial gradient background */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 20% 10%, rgba(56, 189, 248, 0.06), transparent 40%), radial-gradient(circle at 80% 90%, rgba(16, 185, 129, 0.04), transparent 40%)",
        }}
      />

      <div className="mx-auto max-w-5xl px-6 py-10 sm:px-8 lg:px-12">
        {/* Back button */}
        <Link
          href="/"
          className="group mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[14px] text-slate-300 transition hover:border-cyan-300/20 hover:bg-white/[0.06] hover:text-white"
        >
          <span className="transition-transform group-hover:-translate-x-0.5">
            ←
          </span>
          <span>Back to Chat</span>
        </Link>

        {/* Header */}
        <header className="mb-10">
          <h1 className="text-[28px] font-bold tracking-tight text-white sm:text-[36px]">
            Accuracy &amp; Ingestion Comparison
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-slate-400">
            Before vs After switching to{" "}
            <span className="font-medium text-cyan-300">LiteParse</span> +{" "}
            <span className="font-medium text-cyan-300">arXiv PDFs</span>
          </p>
        </header>


        {/* ─── Performance Charts (Cartesian vertical layout) ─── */}
        <section className="mb-12">
          <div className="flex flex-col gap-10 lg:flex-row">
            {PERFORMANCE_METRICS.map((group) => (
              <div key={group.category} className="flex-1 rounded-[24px] border border-white/5 bg-white/[0.02] p-6 sm:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <h2 className="text-[20px] font-semibold text-white">{group.category}</h2>
                <p className="mt-2 text-[14px] text-slate-400">{group.description}</p>

                {/* Vertical Chart Area */}
                <div className="relative mt-12 h-[340px] w-full flex">
                  {/* Y-axis Labels */}
                  <div className="flex flex-col justify-between text-right text-[10px] uppercase tracking-wider font-semibold text-slate-500 pr-3 sm:pr-4 pb-[40px] border-r border-white/10 w-[55px] sm:w-[65px] z-10 shrink-0">
                    <span>Max</span>
                    <span>High</span>
                    <span>Med</span>
                    <span>Low</span>
                    <span>Zero</span>
                  </div>

                  {/* Chart Body */}
                  <div className="relative flex-1 flex flex-col">
                    {/* Horizontal Grid Lines */}
                    <div className="absolute inset-0 bottom-[40px] flex flex-col justify-between pointer-events-none z-0">
                      <div className="border-t border-white/5 w-full h-[1px]"></div>
                      <div className="border-t border-white/5 w-full h-[1px]"></div>
                      <div className="border-t border-white/5 w-full h-[1px]"></div>
                      <div className="border-t border-white/5 w-full h-[1px]"></div>
                      <div className="border-t border-white/20 w-full h-[1px]"></div>
                    </div>

                    {/* X-axis Columns */}
                    <div className="absolute inset-0 bottom-[40px] flex items-end justify-around pl-1 sm:pl-4 z-10">
                      {group.items.map((item) => (
                        <div key={item.id} className="relative flex flex-col items-center h-[85%] w-full">
                          <div className="flex items-end gap-2 sm:gap-4 h-full w-full justify-center">

                            {/* Old Bar */}
                            <div className="flex flex-col justify-end items-center h-full w-[28px] sm:w-[36px]">
                              <div
                                className="relative w-full bg-rose-500/70 rounded-t-[4px] transition-all hover:bg-rose-500 z-10"
                                style={{ height: `${item.oldPct}%` }}
                              >
                                <span className="absolute -top-[24px] left-1/2 -translate-x-1/2 text-[10px] sm:text-[11px] font-mono text-rose-300 text-center whitespace-nowrap bg-[#0B0F14]/60 px-0.5 rounded backdrop-blur-sm">
                                  {item.oldVal}
                                </span>
                              </div>
                            </div>

                            {/* New Bar */}
                            <div className="relative flex flex-col justify-end items-center h-full w-[28px] sm:w-[36px]">
                              {item.delta && (
                                <div 
                                  className="absolute w-full border-t border-l border-r border-dashed border-emerald-400/30 bg-emerald-400/[0.03] rounded-t-[4px] flex flex-col items-center justify-center z-0"
                                  style={{ bottom: `${item.newPct}%`, height: `${item.oldPct - item.newPct}%` }}
                                >
                                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-emerald-400/60 -rotate-90 whitespace-nowrap tracking-wider">
                                    {item.delta}
                                  </span>
                                </div>
                              )}
                              
                              <div
                                className="relative w-full bg-emerald-400 rounded-t-[4px] transition-all shadow-[0_0_12px_rgba(52,211,153,0.3)] hover:bg-emerald-300 z-10"
                                style={{ height: `${item.newPct}%` }}
                              >
                                <span className="absolute -top-[24px] left-1/2 -translate-x-1/2 text-[10px] sm:text-[11px] font-mono font-bold text-emerald-400 text-center whitespace-nowrap bg-[#0B0F14]/60 px-0.5 rounded backdrop-blur-sm">
                                  {item.newVal}
                                </span>
                              </div>
                            </div>

                          </div>

                          {/* X-axis Label */}
                          <div className="absolute -bottom-[36px] text-center text-[10px] sm:text-[11px] font-semibold text-slate-300 leading-tight">
                            <span>{item.title}</span>
                            {item.sub && (
                              <>
                                <br />
                                <span className="text-[9px] font-normal text-slate-500">{item.sub}</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div className="mt-8 flex flex-wrap items-center justify-center gap-6 border-t border-white/5 pt-6">
                  <div className="flex items-center gap-2 text-[11px] sm:text-[12px] font-medium tracking-wide text-slate-400">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80"></span> Old System
                  </div>
                  <div className="flex items-center gap-2 text-[11px] sm:text-[12px] font-medium tracking-wide text-slate-200">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]"></span> New System
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>


        {/* ─── Ingestion timeline ─── */}
        <section className="mb-12">
          <h2 className="mb-5 text-[20px] font-semibold text-white">
            Ingestion Pipeline
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 min-w-max">
              {PIPELINE_STEPS.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 transition hover:border-cyan-300/20 hover:bg-white/[0.05]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-slate-300">
                      {i + 1}
                    </span>
                    <span className="whitespace-nowrap text-[13px] font-medium text-slate-200">
                      {step.label}
                    </span>
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div className="flex items-center text-slate-600">
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>



        {/* Footer */}
        <footer className="border-t border-white/10 pt-6 text-center text-[13px] text-slate-500">
          Spinabot RAG — LiteParse + arXiv · Fully local pipeline
        </footer>
      </div>
    </div>
  );
}
