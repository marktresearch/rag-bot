# Distributed Drive Ingestion

This worker is designed for a 5-instance rollout:

- Render: `WORKER_ID=0`, `WORKER_ID=1`, `WORKER_ID=2`
- Railway: `WORKER_ID=3`, `WORKER_ID=4`
- All workers: `TOTAL_WORKERS=5`

## Runtime contract

- Auth uses `GOOGLE_SERVICE_ACCOUNT_JSON` only. No browser or frontend token flow is required.
- `GOOGLE_SERVICE_ACCOUNT_JSON` may be raw JSON, base64-encoded JSON, or an absolute path to the JSON file.
- Each worker scans the same Drive tree, but only processes files where `simpleHash(fileId) % TOTAL_WORKERS === WORKER_ID`.
- Every file is claimed in Convex before processing and finalized through `processedFiles`.
- Batch uploads use deterministic RAG keys: `fileId::batch::batchIndex`.
- Retries are file-level and capped by `MAX_RETRIES`.
- Images larger than `OCR_MAX_MB` are skipped as `done` with a skip reason to avoid OOMs.
- Replayed batches are deduplicated by content hash, and dataset counters only advance for newly inserted chunks so restarts resume cleanly.
- Node is pinned to `22.x` through [package.json](/home/shanthant/Downloads/ragbot/package.json) and [.node-version](/home/shanthant/Downloads/ragbot/.node-version).

## Required environment

Use the values in [.env.worker.example](/home/shanthant/Downloads/ragbot/.env.worker.example) for every worker:

- `CONVEX_URL`
- `DRIVE_FOLDER_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `DISCORD_WEBHOOK_URL`
- `TOTAL_WORKERS`
- `WORKER_ID`
- `BATCH_SIZE`
- `FILE_CONCURRENCY`
- `UPLOAD_CONCURRENCY`
- `POLL_INTERVAL_MS`
- `MAX_RETRIES`
- `OCR_MAX_MB`

Recommended defaults:

- `BATCH_SIZE=40`
- `FILE_CONCURRENCY=1`
- `UPLOAD_CONCURRENCY=3`
- `POLL_INTERVAL_MS=30000`
- `POLL_STAGGER_MS=2000`
- `POLL_JITTER_MS=3000`
- `MAX_RETRIES=2`
- `DRIVE_LIST_PAGE_SIZE=200`
- `OCR_MAX_MB=8`
- `OCR_NUM_WORKERS=1`

## Deploying on Render

1. Create a new Blueprint deploy from [render.yaml](/home/shanthant/Downloads/ragbot/render.yaml).
2. Confirm the repo is reachable by Render. Render cannot deploy directly from an unversioned local folder.
3. Set shared secrets on all three workers:
   `CONVEX_URL`, `DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DISCORD_WEBHOOK_URL`
4. Keep `TOTAL_WORKERS=5`.
5. Verify the three worker instances have `WORKER_ID=0`, `1`, and `2`.
6. Leave auto-deploy enabled and keep logs on.

## Deploying on Railway

1. Create one Railway service from this repo using [railway.json](/home/shanthant/Downloads/ragbot/railway.json).
2. Duplicate that service once so you have two Railway workers.
3. Set the same shared secrets on both services.
4. Set `TOTAL_WORKERS=5` on both.
5. Set `WORKER_ID=3` on one service and `WORKER_ID=4` on the other.
6. Keep restart-on-failure enabled and logs visible.

## Operational checks

- All workers must point at the same `DRIVE_FOLDER_ID` and `CONVEX_URL`.
- All workers must use the same namespace: `drive_${DRIVE_FOLDER_ID}`.
- Render and Railway should both receive the same cloud-safe tuning values:
  `POLL_INTERVAL_MS=30000`, `POLL_STAGGER_MS=2000`, `POLL_JITTER_MS=3000`, `DRIVE_LIST_PAGE_SIZE=200`, `OCR_NUM_WORKERS=1`
- Convex `processedFiles` should show `done`, `processing`, or `failed`.
- Permanent failures notify Discord after retry exhaustion.
- A burst of repeated failures also emits a Discord alert.
- Worker crashes notify Discord and rely on the host platform to restart the process.

## Success signals

- `processedFiles.status="done"` grows steadily.
- Dataset chunk counts in Convex keep rising.
- Render and Railway worker logs show distinct `WORKER_ID`s.
- No duplicate `fileId::batch::*` entries are created across workers.
