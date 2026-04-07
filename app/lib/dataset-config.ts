/**
 * Static dataset configuration constants.
 *
 * `DEFAULT_NAMESPACE` is used as a fallback when no explicit namespace is
 * provided.  The *active* namespace is stored in the Convex `userSettings`
 * table and should be fetched at runtime — never rely on this constant as
 * the single source of truth for which namespace to query.
 */

export const DEFAULT_NAMESPACE = "arxiv";

export const DATASET_SOURCE = "arXiv PDFs";
export const DATASET_DOMAIN = "AI and machine learning research";

export const CUSTOM_DATASET_NAME = "LiteParse arXiv PDF Corpus";
export const CUSTOM_DATASET_VERSION = "liteparse-arxiv-v1";
export const DATASET_NAME = CUSTOM_DATASET_NAME;
export const DATASET_VERSION = CUSTOM_DATASET_VERSION;
export const DATASET_KEY = CUSTOM_DATASET_VERSION;
