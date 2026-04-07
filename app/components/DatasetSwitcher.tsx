"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type DatasetSwitcherProps = {
  activeNamespace: string;
  onNamespaceChange?: (ns: string) => void;
};

export default function DatasetSwitcher({
  activeNamespace,
  onNamespaceChange,
}: DatasetSwitcherProps) {
  const datasets = useQuery(api.userSettings.listDatasets) ?? [];
  const setActiveNamespace = useMutation(api.userSettings.setActiveNamespace);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const namespace = event.target.value;
    await setActiveNamespace({ namespace });
    onNamespaceChange?.(namespace);
  }

  const statusDot = (status: string) => {
    switch (status) {
      case "ready":
        return "bg-emerald-400";
      case "ingesting":
        return "bg-amber-400 animate-pulse";
      case "failed":
        return "bg-rose-400";
      default:
        return "bg-slate-400";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="dataset-switcher"
        className="text-[11px] font-medium uppercase tracking-wider text-slate-500"
      >
        Dataset
      </label>
      <div className="relative">
        <select
          id="dataset-switcher"
          value={activeNamespace}
          onChange={handleChange}
          className="appearance-none rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-8 text-[13px] text-slate-200 outline-none transition hover:border-white/20 focus:border-cyan-300/40 focus:ring-1 focus:ring-cyan-300/20"
        >
          {datasets.length === 0 ? (
            <option value={activeNamespace}>{activeNamespace}</option>
          ) : (
            datasets.map((ds) => (
              <option key={ds.namespace} value={ds.namespace}>
                {ds.name} ({ds.chunkCount.toLocaleString()} chunks)
              </option>
            ))
          )}
        </select>
        {/* dropdown arrow */}
        <svg
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {/* status indicator for active dataset */}
      {datasets.length > 0 && (
        <span
          className={`h-2 w-2 rounded-full ${statusDot(
            datasets.find((ds) => ds.namespace === activeNamespace)?.status ?? "pending"
          )}`}
          title={
            datasets.find((ds) => ds.namespace === activeNamespace)?.status ?? "unknown"
          }
        />
      )}
    </div>
  );
}
