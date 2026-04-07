import type { ChatMessage, ChatSummary, DatasetInfo, RouteKind, StatusResponse } from "@/app/lib/api-types";
import {
  EXISTING_INDEXED_DATASET_MESSAGE,
  STORAGE_LIMIT_REACHED_MESSAGE,
  getProcessedChunkCount as resolveProcessedChunkCount,
  isChatReadyForIndexedDataset,
} from "@/lib/rag-config";

export const ACTIVE_CHAT_STORAGE_KEY = "spinabot:active-chat";

export type StatusPill = {
  label: string;
  tone: string;
  dotTone?: string;
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatCount(value: number | null | undefined) {
  if (!value || value <= 0) {
    return "0";
  }

  return value.toLocaleString();
}

export function formatRelativeTime(value: number | null) {
  if (!value) {
    return "No activity yet";
  }

  const delta = value - Date.now();
  const minutes = Math.round(delta / 60_000);

  if (Math.abs(minutes) < 1) {
    return "Just now";
  }

  if (Math.abs(minutes) < 60) {
    return `${Math.abs(minutes)}m ${minutes < 0 ? "ago" : "from now"}`;
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return `${Math.abs(hours)}h ${hours < 0 ? "ago" : "from now"}`;
  }

  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${days < 0 ? "ago" : "from now"}`;
}

export function formatMessageTime(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRouteLabel(route: RouteKind | null | undefined) {
  if (!route) {
    return "No route yet";
  }

  return route
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatLatency(value: number | null | undefined) {
  if (!value || value <= 0) {
    return "No latency yet";
  }

  return `${value}ms`;
}

export function formatDatasetStatus(dataset: DatasetInfo | null, hasDocuments: boolean | undefined) {
  if (!dataset) {
    return "Preparing";
  }

  if (dataset.status === "ready") {
    return "Ready";
  }

  if (dataset.status === "failed") {
    return "Failed";
  }

  if (dataset.status === "pending" || dataset.status === "ingesting") {
    return "Ingesting";
  }

  return hasDocuments ? "Ready" : "Ingesting";
}

export function getDatasetProgress(dataset: DatasetInfo | null) {
  if (!dataset) {
    return 0;
  }

  if (typeof dataset.progressPct === "number" && Number.isFinite(dataset.progressPct)) {
    return Math.max(0, Math.min(100, Math.round(dataset.progressPct)));
  }

  if (
    typeof dataset.ingestionProgressPct === "number" &&
    Number.isFinite(dataset.ingestionProgressPct)
  ) {
    return Math.max(0, Math.min(100, Math.round(dataset.ingestionProgressPct)));
  }

  if (
    typeof dataset.ingestedChunkCount === "number" &&
    Number.isFinite(dataset.ingestedChunkCount) &&
    dataset.chunkCount > 0
  ) {
    return Math.max(
      0,
      Math.min(100, Math.round((dataset.ingestedChunkCount / dataset.chunkCount) * 100))
    );
  }

  return dataset.status === "ready" ? 100 : 0;
}

export function getProcessedChunkCount(dataset: DatasetInfo | null) {
  return resolveProcessedChunkCount(dataset);
}

export function isChatEnabled(status: StatusResponse | null) {
  if (!status) {
    return false;
  }

  return isChatReadyForIndexedDataset(status.dataset);
}

export function insertChat(chats: ChatSummary[], chat: ChatSummary) {
  return [chat, ...chats.filter((entry) => entry.id !== chat.id)];
}

export function buildStatusPills(
  status: StatusResponse | null,
  latestAssistantMessage: ChatMessage | null
) {
  const isConnected = status?.backend === "connected";
  const datasetState = formatDatasetStatus(status?.dataset ?? null, status?.index.hasDocuments);
  const progress = getDatasetProgress(status?.dataset ?? null);
  const latency =
    latestAssistantMessage?.metadata?.metrics?.latencyMs ?? status?.telemetry.averageLatencyMs ?? null;
  const indexedChunks =
    status?.index.documentCount ?? getProcessedChunkCount(status?.dataset ?? null);
  const queuedChunks = status?.dataset?.queuedChunkCount ?? 0;
  let detail: string;

  if (status?.system.storageLimited) {
    detail = STORAGE_LIMIT_REACHED_MESSAGE;
  } else if (status?.system.usingExistingIndex) {
    detail = EXISTING_INDEXED_DATASET_MESSAGE;
  } else if (datasetState === "Ready") {
    detail = formatLatency(latency);
  } else if (datasetState === "Failed") {
    detail = "Ingestion failed";
  } else {
    detail = `${progress}% indexed`;
  }

  const datasetTone =
    datasetState === "Ready"
      ? "border-sky-400/20 bg-sky-400/10 text-sky-100"
      : datasetState === "Failed"
        ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
        : "border-amber-400/20 bg-amber-400/10 text-amber-100";
  const detailTone = status?.system.storageLimited
    ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
    : status?.system.usingExistingIndex
      ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
      : datasetState === "Failed"
        ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
        : datasetState === "Ready"
          ? "border-white/10 bg-white/[0.04] text-slate-200"
          : "border-amber-400/20 bg-amber-400/10 text-amber-100";

  return [
    {
      label: isConnected ? "Connected" : "Connecting",
      tone: isConnected
        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
        : "border-amber-400/20 bg-amber-400/10 text-amber-100",
      dotTone: isConnected ? "bg-emerald-300" : "bg-amber-300",
    },
    {
      label: `Dataset: ${datasetState}`,
      tone: datasetTone,
      dotTone:
        datasetState === "Ready"
          ? "bg-sky-300"
          : datasetState === "Failed"
            ? "bg-rose-300"
            : "bg-amber-300",
    },
    {
      label: detail,
      tone: detailTone,
    },
    {
      label:
        indexedChunks > 0 || queuedChunks <= 0
          ? `${formatCount(indexedChunks)} indexed chunks`
          : `${formatCount(queuedChunks)} queued chunks`,
      tone: "border-white/10 bg-white/[0.04] text-slate-200",
    },
  ] satisfies StatusPill[];
}

export function buildStatusLine(status: StatusResponse | null, latestAssistantMessage: ChatMessage | null) {
  return buildStatusPills(status, latestAssistantMessage)
    .map((pill) => pill.label)
    .join(" • ");
}
