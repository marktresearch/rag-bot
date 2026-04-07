import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  buildGoogleOAuthUrl,
  getGoogleOAuthClientId,
  getGoogleOAuthRedirectUri,
} from "@/shared/driveOAuth";

const STATE_COOKIE_NAME = "drive_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectUri = getGoogleOAuthRedirectUri(request.url);
  const state = randomUUID();

  const response = NextResponse.redirect(
    buildGoogleOAuthUrl({
      clientId: getGoogleOAuthClientId(),
      redirectUri,
      state,
    })
  );

  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
