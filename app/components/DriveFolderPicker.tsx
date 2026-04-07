"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  DriveConnectionStatus,
  DriveFolder,
  DriveProgressStatus,
  StatusResponse,
  DriveWorkerStatus,
} from "@/app/lib/api-types";

type FolderResponse = {
  folders: DriveFolder[];
  parentId?: string | null;
  query?: string | null;
  error?: string;
};

type Breadcrumb = {
  id: string | null;
  name: string;
};

const ROOT_CRUMB: Breadcrumb = {
  id: null,
  name: "Root",
};

function ProgressCircle({
  progressPct,
  label,
}: {
  progressPct: number;
  label: string;
}) {
  const normalized =
    progressPct >= 100 ? 100 : Math.max(0, Math.min(99, Math.floor(progressPct)));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalized / 100);

  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <svg
        viewBox="0 0 96 96"
        className="h-24 w-24 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke="rgb(228 228 231)"
          strokeWidth="8"
        />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeLinecap="round"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold text-zinc-950">{normalized}%</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </span>
      </div>
    </div>
  );
}

export default function DriveFolderPicker() {
  const [connection, setConnection] = useState<DriveConnectionStatus | null>(null);
  const [workerStatus, setWorkerStatus] = useState<DriveWorkerStatus | null>(null);
  const [ingestionStatus, setIngestionStatus] = useState<StatusResponse | null>(null);
  const [driveProgress, setDriveProgress] = useState<DriveProgressStatus | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [query, setQuery] = useState("");
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [loadingWorkerStatus, setLoadingWorkerStatus] = useState(true);
  const [loadingIngestionStatus, setLoadingIngestionStatus] = useState(false);
  const [loadingDriveProgress, setLoadingDriveProgress] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([ROOT_CRUMB]);

  async function loadConnection() {
    setLoadingConnection(true);
    try {
      const response = await fetch("/api/drive/connection", { cache: "no-store" });
      const payload = (await response.json()) as DriveConnectionStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load Google Drive connection.");
      }

      setConnection(payload);
      return payload;
    } finally {
      setLoadingConnection(false);
    }
  }

  async function loadWorkerStatus() {
    setLoadingWorkerStatus(true);
    try {
      const response = await fetch("/api/drive/ingest", { cache: "no-store" });
      const payload = (await response.json()) as DriveWorkerStatus & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load ingestion worker status.");
      }

      setWorkerStatus(payload);
      return payload;
    } catch (caughtError: unknown) {
      setWorkerStatus(null);
      setError((current) =>
        current ?? (caughtError instanceof Error ? caughtError.message : String(caughtError))
      );
      return null;
    } finally {
      setLoadingWorkerStatus(false);
    }
  }

  async function loadIngestionStatus(namespace: string) {
    setLoadingIngestionStatus(true);
    try {
      const response = await fetch(`/api/status?namespace=${encodeURIComponent(namespace)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as StatusResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load ingestion status.");
      }

      setIngestionStatus(payload);
      return payload;
    } catch (caughtError: unknown) {
      setIngestionStatus(null);
      setError((current) =>
        current ?? (caughtError instanceof Error ? caughtError.message : String(caughtError))
      );
      return null;
    } finally {
      setLoadingIngestionStatus(false);
    }
  }

  async function loadDriveProgress(namespace: string) {
    setLoadingDriveProgress(true);
    try {
      const response = await fetch(`/api/drive/progress?namespace=${encodeURIComponent(namespace)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as DriveProgressStatus & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load Drive ingestion progress.");
      }

      setDriveProgress(payload);
      return payload;
    } catch (caughtError: unknown) {
      setDriveProgress(null);
      setError((current) =>
        current ?? (caughtError instanceof Error ? caughtError.message : String(caughtError))
      );
      return null;
    } finally {
      setLoadingDriveProgress(false);
    }
  }

  async function loadFolders(args?: { parentId?: string | null; search?: string }) {
    setLoadingFolders(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (args?.parentId) {
        params.set("parentId", args.parentId);
      }
      if (args?.search?.trim()) {
        params.set("query", args.search.trim());
      }

      const response = await fetch(
        `/api/drive/folders${params.toString() ? `?${params.toString()}` : ""}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as FolderResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load folders.");
      }

      setFolders(payload.folders ?? []);
    } catch (caughtError: unknown) {
      setFolders([]);
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setLoadingFolders(false);
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const driveStatus = url.searchParams.get("drive");
    const message = url.searchParams.get("message");

    if (driveStatus === "connected") {
      setNotice("Google Drive connected. Choose the folder you want to ingest.");
      url.searchParams.delete("drive");
      window.history.replaceState({}, "", url.toString());
    } else if (driveStatus === "error") {
      setError(message ?? "Google Drive connection failed.");
      url.searchParams.delete("drive");
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url.toString());
    }

    void loadConnection().then((payload) => {
      if (payload.connected) {
        void loadFolders();
        if (payload.namespace) {
          void loadIngestionStatus(payload.namespace);
          void loadDriveProgress(payload.namespace);
        }
      }
    });

    void loadWorkerStatus();
  }, []);

  useEffect(() => {
    if (!connection?.connected) {
      setWorkerStatus(null);
      setDriveProgress(null);
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadWorkerStatus();
      void loadConnection();
      if (connection.namespace) {
        void loadIngestionStatus(connection.namespace);
        void loadDriveProgress(connection.namespace);
      }
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [connection?.connected, connection?.namespace]);

  async function handleConnect() {
    window.location.assign("/api/drive/auth/start");
  }

  async function handleDisconnect() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/drive/connection", {
        method: "DELETE",
      });
      const payload = (await response.json()) as { cleared?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to disconnect Google Drive.");
      }

      setNotice("Google Drive disconnected.");
      setBreadcrumbs([ROOT_CRUMB]);
      setFolders([]);
      setWorkerStatus(null);
      setIngestionStatus(null);
      setDriveProgress(null);
      await loadConnection();
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUseFolder(folder: DriveFolder) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/drive/folders/select", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folderId: folder.id,
          folderName: folder.name,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save the selected folder.");
      }

      setNotice(`Folder selected: "${folder.name}". Click Ingest Data to start the background job.`);
      const nextConnection = await loadConnection();
      await Promise.all([
        loadWorkerStatus(),
        nextConnection.namespace ? loadIngestionStatus(nextConnection.namespace) : Promise.resolve(),
        nextConnection.namespace ? loadDriveProgress(nextConnection.namespace) : Promise.resolve(),
      ]);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartIngestion() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/drive/ingest", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        worker?: DriveWorkerStatus & { started?: boolean };
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to start background ingestion.");
      }

      setNotice(
        payload.worker?.started === false
          ? "Background ingestion is already running. You can close the browser and it will continue."
          : "Background ingestion started. You can close the browser and it will continue."
      );
      const nextConnection = await loadConnection();
      await Promise.all([
        loadWorkerStatus(),
        nextConnection.namespace ? loadIngestionStatus(nextConnection.namespace) : Promise.resolve(),
        nextConnection.namespace ? loadDriveProgress(nextConnection.namespace) : Promise.resolve(),
      ]);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenFolder(folder: DriveFolder) {
    setBreadcrumbs((current) => [...current, { id: folder.id, name: folder.name }]);
    await loadFolders({ parentId: folder.id });
  }

  async function handleGoToCrumb(index: number) {
    const nextBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(nextBreadcrumbs);
    await loadFolders({ parentId: nextBreadcrumbs[nextBreadcrumbs.length - 1]?.id ?? null });
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadFolders({ search: query });
  }

  const hasSelectedFolder = Boolean(connection?.folderId && connection?.namespace);
  const ingestionRunning = Boolean(connection?.ingestionEnabled && workerStatus?.running);
  const ingestButtonLabel = ingestionRunning
    ? "Ingestion Running"
    : hasSelectedFolder
      ? "Ingest Data"
      : "Select Folder First";
  const processedChunks = ingestionStatus?.dataset?.processedChunks ?? 0;
  const totalChunks = ingestionStatus?.dataset?.chunkCount ?? 0;
  const pendingChunks = ingestionStatus?.dataset?.pendingChunkCount ?? Math.max(0, totalChunks - processedChunks);
  const datasetStatus = ingestionStatus?.dataset?.status ?? "pending";
  const chunkProgressPct =
    totalChunks > 0 ? ingestionStatus?.dataset?.progressPct ?? 0 : 0;
  const fileProgressPct =
    driveProgress?.totalFiles && driveProgress.totalFiles > 0 ? driveProgress.progressPct ?? 0 : 0;
  const completedFiles = driveProgress?.completedFiles ?? 0;
  const totalFiles = driveProgress?.totalFiles ?? 0;
  const remainingFiles = driveProgress?.remainingFiles ?? Math.max(0, totalFiles - completedFiles);
  const processingFiles = driveProgress?.processingFiles ?? 0;
  const failedFiles = driveProgress?.failedFiles ?? 0;
  const displayProgressPct = totalFiles > 0 ? fileProgressPct : chunkProgressPct;

  return (
    <section className="w-full max-w-5xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
              Google Drive
            </p>
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold text-zinc-950">
                Connect an account and choose the folder to ingest.
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-zinc-600">
                The dashboard now owns Google login and folder selection. Once a
                folder is chosen, the backend worker can continue ingesting it in
                the background without needing your browser to stay open.
              </p>
            </div>
          </div>

          {connection?.connected ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handleStartIngestion()}
                disabled={submitting || !hasSelectedFolder || ingestionRunning}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                {ingestButtonLabel}
              </button>
              <button
                onClick={() => void handleDisconnect()}
                disabled={submitting}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => void handleConnect()}
              disabled={loadingConnection}
              className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
            >
              Connect Google Drive
            </button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[1.2fr_2fr]">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Connection
                </p>
                <p className="mt-2 text-sm text-zinc-700">
                  {loadingConnection
                    ? "Loading connection..."
                    : connection?.connected
                      ? `Connected as ${connection.accountName ?? connection.accountEmail}`
                      : "No Google account connected yet."}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Selected Folder
                </p>
                <p className="mt-2 text-sm font-medium text-zinc-950">
                  {connection?.folderName ?? "Nothing selected yet"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {connection?.namespace ?? "Choose a folder below to start hosted ingestion."}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Ingestion Worker
                </p>
                <p className="mt-2 text-sm font-medium text-zinc-950">
                  {loadingWorkerStatus
                    ? "Checking background worker..."
                    : ingestionRunning
                      ? "Running in the background"
                      : workerStatus?.running
                        ? "Worker online, waiting for Ingest Data"
                        : "Waiting to be started"}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {ingestionRunning
                    ? "Downloads, parsing, OCR, chunking, and Convex uploads will continue even if you close the browser."
                    : hasSelectedFolder
                      ? "Click Ingest Data to launch the detached background worker from the app server."
                      : "Choose a folder first, then start the background job from here."}
                </p>
                {hasSelectedFolder ? (
                  <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-500">
                      Convex Progress
                    </p>
                    <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
                      <ProgressCircle
                        progressPct={displayProgressPct}
                        label={totalFiles > 0 ? "files" : "chunks"}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-sm font-medium text-zinc-950">
                          {loadingIngestionStatus || loadingDriveProgress
                            ? "Loading live ingestion progress..."
                            : totalFiles > 0
                              ? `${completedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} files completed`
                              : totalChunks > 0
                                ? `${processedChunks.toLocaleString()} of ${totalChunks.toLocaleString()} chunks indexed`
                                : "Scanning the Drive folder to estimate remaining work..."}
                        </p>
                        <div className="grid gap-2 text-xs leading-5 text-zinc-500 sm:grid-cols-2">
                          <p>
                            {totalChunks > 0
                              ? `${processedChunks.toLocaleString()} indexed, ${pendingChunks.toLocaleString()} currently left in the Convex queue.`
                              : "Chunk total will appear once the worker has queued files into Convex."}
                          </p>
                          <p>
                            {totalFiles > 0
                              ? `${remainingFiles.toLocaleString()} files left, ${processingFiles.toLocaleString()} active, ${failedFiles.toLocaleString()} retrying.`
                              : "File totals appear after the background worker finishes a full folder scan."}
                          </p>
                        </div>
                        <p className="text-xs leading-5 text-zinc-500">
                          {loadingIngestionStatus || loadingDriveProgress
                            ? "Checking the selected namespace in Convex."
                            : `Dataset status: ${datasetStatus}. The circle tracks overall file completion. Chunk counts can keep rising while more files are still being parsed and queued.`}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  How It Works
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Google OAuth stays in the app, folder selection is saved in Convex,
                  and clicking Ingest Data launches the background worker on the
                  server so ingestion keeps going without another terminal.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            {!connection?.connected ? (
              <div className="flex h-full min-h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm leading-6 text-zinc-500">
                Connect a Google account first, then this panel will let you browse
                folders or search by name.
              </div>
            ) : (
              <div className="space-y-4">
                <form
                  onSubmit={(event) => void handleSearch(event)}
                  className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 md:flex-row"
                >
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search folders by name"
                    className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-950"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loadingFolders}
                      className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
                    >
                      Search
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setBreadcrumbs([ROOT_CRUMB]);
                        void loadFolders();
                      }}
                      disabled={loadingFolders}
                      className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-60"
                    >
                      Root
                    </button>
                  </div>
                </form>

                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {breadcrumbs.map((crumb, index) => (
                    <button
                      key={`${crumb.id ?? "root"}-${index}`}
                      type="button"
                      onClick={() => void handleGoToCrumb(index)}
                      className={`rounded-full border px-3 py-1 transition ${
                        index === breadcrumbs.length - 1
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                      }`}
                    >
                      {crumb.name}
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white">
                  {loadingFolders ? (
                    <div className="p-6 text-sm text-zinc-500">Loading folders...</div>
                  ) : folders.length === 0 ? (
                    <div className="p-6 text-sm text-zinc-500">
                      No folders found here. Try a different location or search by name.
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-200">
                      {folders.map((folder) => {
                        const isSelected = connection.folderId === folder.id;

                        return (
                          <div
                            key={folder.id}
                            className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-zinc-950">
                                {folder.name}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">{folder.id}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleOpenFolder(folder)}
                                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
                              >
                                Open
                              </button>
                              <button
                                type="button"
                                disabled={submitting && isSelected}
                                onClick={() => void handleUseFolder(folder)}
                                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                  isSelected
                                    ? "bg-emerald-600 text-white"
                                    : "bg-zinc-950 text-white hover:bg-zinc-800"
                                }`}
                              >
                                {isSelected ? "Selected" : "Use Folder"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {notice ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
