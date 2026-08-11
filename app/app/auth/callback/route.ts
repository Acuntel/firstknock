import { NextResponse } from "next/server";
import { sessionClient } from "@/lib/session";
import { appUrl } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Where the emailed link lands.
 *
 * Exchanges the one time code for a session cookie. This has to be a route
 * handler rather than a page, because a server component cannot set cookies and
 * the session is a cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");

  const client = await sessionClient();

  // Two shapes arrive here. A link the login form started carries a PKCE code,
  // whose verifier is already in a cookie. A link minted server side, by the
  // admin API or an email template using {{ .TokenHash }}, carries a token hash
  // and no verifier, so it has to be verified rather than exchanged. Supporting
  // only the first would make every invite link fail.
  const { error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : tokenHash
      ? await client.auth.verifyOtp({
          token_hash: tokenHash,
          type: (url.searchParams.get("type") as "email" | "magiclink") ?? "email",
        })
      : { error: { message: "That link is missing its sign in token." } };

  if (error) {
    return NextResponse.redirect(
      `${appUrl()}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${appUrl()}/today`);
}
