import "server-only";

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type WorkerProcessRecord = {
  pid: number;
  startedAt: number;
};

type WorkerStartResult = {
  started: boolean;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  logPath: string | null;
};

const RUNTIME_DIRECTORY = path.join(process.cwd(), ".runtime");
const WORKER_RECORD_PATH = path.join(RUNTIME_DIRECTORY, "drive-worker.json");
const WORKER_LOG_PATH = path.join(RUNTIME_DIRECTORY, "drive-worker.log");
const WORKER_ENTRYPOINT = path.join(process.cwd(), "worker", "drive_ingest.ts");

async function ensureRuntimeDirectory() {
  await mkdir(RUNTIME_DIRECTORY, { recursive: true });
}

function isPidRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readWorkerRecord() {
  try {
    const raw = await readFile(WORKER_RECORD_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkerProcessRecord>;

    if (
      typeof parsed.pid !== "number" ||
      !Number.isFinite(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.startedAt !== "number" ||
      !Number.isFinite(parsed.startedAt)
    ) {
      await rm(WORKER_RECORD_PATH, { force: true });
      return null;
    }

    if (!isPidRunning(parsed.pid)) {
      await rm(WORKER_RECORD_PATH, { force: true });
      return null;
    }

    return {
      pid: Math.trunc(parsed.pid),
      startedAt: Math.trunc(parsed.startedAt),
    };
  } catch {
    return null;
  }
}

export async function getDriveWorkerStatus() {
  const record = await readWorkerRecord();

  return {
    running: Boolean(record),
    pid: record?.pid ?? null,
    startedAt: record?.startedAt ?? null,
    logPath: record ? WORKER_LOG_PATH : null,
  };
}

export async function startDriveWorker(): Promise<WorkerStartResult> {
  const existing = await readWorkerRecord();
  if (existing) {
    return {
      started: false,
      running: true,
      pid: existing.pid,
      startedAt: existing.startedAt,
      logPath: WORKER_LOG_PATH,
    };
  }

  await ensureRuntimeDirectory();
  const logFd = openSync(WORKER_LOG_PATH, "a");

  try {
    const child = spawn(process.execPath, ["--import", "tsx", WORKER_ENTRYPOINT], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    if (!child.pid) {
      throw new Error("Drive ingestion worker did not return a process id.");
    }

    child.unref();

    const startedAt = Date.now();
    await writeFile(
      WORKER_RECORD_PATH,
      JSON.stringify(
        {
          pid: child.pid,
          startedAt,
        } satisfies WorkerProcessRecord,
        null,
        2
      )
    );

    return {
      started: true,
      running: true,
      pid: child.pid,
      startedAt,
      logPath: WORKER_LOG_PATH,
    };
  } finally {
    closeSync(logFd);
  }
}

export async function stopDriveWorker() {
  const record = await readWorkerRecord();

  if (record) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
      // Ignore already-dead workers.
    }
  }

  await rm(WORKER_RECORD_PATH, { force: true });

  return {
    stopped: Boolean(record),
    pid: record?.pid ?? null,
  };
}

export async function clearDriveWorkerRuntime() {
  const stopped = await stopDriveWorker();
  await rm(WORKER_LOG_PATH, { force: true });

  return {
    ...stopped,
    clearedLog: true,
  };
}
