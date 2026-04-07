import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const GOOGLE_OAUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ENCRYPTION_PREFIX = "v1";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function getGoogleOAuthClientId() {
  return (
    process.env.GOOGLE_OAUTH_CLIENT_ID ??
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ??
    requireEnv("GOOGLE_OAUTH_CLIENT_ID")
  );
}

export function getGoogleOAuthClientSecret() {
  return requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
}

export function getGoogleOAuthAppOrigin(requestUrl?: string) {
  const explicitOrigin =
    process.env.GOOGLE_OAUTH_APP_ORIGIN ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  if (explicitOrigin) {
    return explicitOrigin.replace(/\/+$/, "");
  }

  if (!requestUrl) {
    throw new Error(
      "Google OAuth app origin is not configured. Set GOOGLE_OAUTH_APP_ORIGIN, APP_URL, NEXT_PUBLIC_SITE_URL, or NEXT_PUBLIC_CONVEX_SITE_URL."
    );
  }

  return new URL(requestUrl).origin;
}

export function getGoogleOAuthRedirectUri(requestUrl?: string) {
  return `${getGoogleOAuthAppOrigin(requestUrl)}/api/drive/auth/callback`;
}

function getEncryptionSecret() {
  return (
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY ??
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ??
    requireEnv("GOOGLE_OAUTH_ENCRYPTION_KEY")
  );
}

function deriveEncryptionKey() {
  return createHash("sha256").update(getEncryptionSecret()).digest();
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function encryptRefreshToken(refreshToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptRefreshToken(payload: string) {
  const [version, ivBase64, authTagBase64, ciphertextBase64] = payload.split(":");
  if (version !== ENCRYPTION_PREFIX || !ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted refresh token payload.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(),
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

export function buildGoogleOAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL(GOOGLE_OAUTH_BASE_URL);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", args.state);
  return url.toString();
}

async function parseJsonResponse<T>(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed with ${response.status}`);
  }
  return JSON.parse(text) as T;
}

export async function exchangeGoogleCodeForTokens(args: {
  code: string;
  redirectUri: string;
  clientId?: string;
  clientSecret?: string;
}) {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId ?? getGoogleOAuthClientId(),
    client_secret: args.clientSecret ?? getGoogleOAuthClientSecret(),
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return await parseJsonResponse<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type: string;
    id_token?: string;
  }>(response);
}

export async function refreshGoogleAccessToken(args: {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}) {
  const body = new URLSearchParams({
    refresh_token: args.refreshToken,
    client_id: args.clientId ?? getGoogleOAuthClientId(),
    client_secret: args.clientSecret ?? getGoogleOAuthClientSecret(),
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return await parseJsonResponse<{
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  }>(response);
}

export async function fetchGoogleUserProfile(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return await parseJsonResponse<{
    email?: string;
    name?: string;
    picture?: string;
  }>(response);
}

export async function listDriveFolders(args: {
  accessToken: string;
  parentId?: string | null;
  query?: string | null;
}) {
  const url = new URL(GOOGLE_DRIVE_FILES_URL);
  const search = args.query?.trim();
  let q = `mimeType='${GOOGLE_DRIVE_FOLDER_MIME_TYPE}' and trashed=false`;

  if (search) {
    q += ` and name contains '${escapeDriveQueryValue(search)}'`;
  } else if (args.parentId) {
    q += ` and '${escapeDriveQueryValue(args.parentId)}' in parents`;
  } else {
    q += " and 'root' in parents";
  }

  url.searchParams.set("q", q);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "name_natural");
  url.searchParams.set("fields", "files(id,name,webViewLink,parents)");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
    },
  });

  const payload = await parseJsonResponse<{
    files?: Array<{
      id: string;
      name: string;
      webViewLink?: string;
      parents?: string[];
    }>;
  }>(response);

  return (payload.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    webViewLink: file.webViewLink ?? null,
    parentId: file.parents?.[0] ?? null,
  }));
}
