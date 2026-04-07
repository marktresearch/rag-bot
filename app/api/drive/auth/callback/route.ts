import { NextResponse } from "next/server";
import { runServerMutation } from "@/app/lib/server/convex";
import {
  encryptRefreshToken,
  exchangeGoogleCodeForTokens,
  fetchGoogleUserProfile,
  getGoogleOAuthAppOrigin,
  getGoogleOAuthRedirectUri,
} from "@/shared/driveOAuth";

const STATE_COOKIE_NAME = "drive_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const appOrigin = getGoogleOAuthAppOrigin(request.url);
  const redirectTarget = new URL("/", appOrigin);

  if (error) {
    redirectTarget.searchParams.set("drive", "error");
    redirectTarget.searchParams.set("message", error);
    return NextResponse.redirect(redirectTarget);
  }

  if (!code || !state) {
    redirectTarget.searchParams.set("drive", "error");
    redirectTarget.searchParams.set("message", "missing_oauth_params");
    return NextResponse.redirect(redirectTarget);
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const storedState = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE_NAME}=`))
    ?.split("=")[1];

  if (!storedState || storedState !== state) {
    redirectTarget.searchParams.set("drive", "error");
    redirectTarget.searchParams.set("message", "invalid_oauth_state");
    return NextResponse.redirect(redirectTarget);
  }

  try {
    const redirectUri = getGoogleOAuthRedirectUri(request.url);
    const tokens = await exchangeGoogleCodeForTokens({
      code,
      redirectUri,
    });

    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Revoke the app and try connecting again."
      );
    }

    const profile = await fetchGoogleUserProfile(tokens.access_token);
    await runServerMutation("drive:saveDriveConnection", {
      accountEmail: profile.email ?? "unknown@google",
      accountName: profile.name,
      encryptedRefreshToken: encryptRefreshToken(tokens.refresh_token),
    });

    redirectTarget.searchParams.set("drive", "connected");
    const response = NextResponse.redirect(redirectTarget);
    response.cookies.set(STATE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (caughtError: unknown) {
    redirectTarget.searchParams.set("drive", "error");
    redirectTarget.searchParams.set(
      "message",
      caughtError instanceof Error ? caughtError.message : String(caughtError)
    );
    return NextResponse.redirect(redirectTarget);
  }
}
