import { redirect } from "next/navigation";
import { currentUser, sessionClient } from "@/lib/session";
import { appUrl } from "@/lib/stripe";

/**
 * Sign in by emailed link.
 *
 * No password, deliberately. These are five operators who log in occasionally
 * from a phone, and a password is one more thing for them to lose and one more
 * thing for us to store. The link is the whole flow.
 */
async function sendLink(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=Enter+your+email+address");

  const client = await sessionClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${appUrl()}/auth/callback` },
  });

  redirect(
    error
      ? `/login?error=${encodeURIComponent(error.message)}`
      : `/login?sent=${encodeURIComponent(email)}`,
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  if (await currentUser()) redirect("/today");

  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold">Sign in to FirstKnock</h1>

      {sent ? (
        <p className="mt-5 rounded-lg border border-ok-bg bg-ok-bg px-4 py-3 text-sm text-ok">
          Check {sent}. The link signs you in and expires in an hour.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            We email you a link. There is no password to remember.
          </p>

          {error ? (
            <p className="mt-4 rounded-lg border border-bad-bg bg-bad-bg px-4 py-3 text-sm text-bad">
              {error}
            </p>
          ) : null}

          <form action={sendLink} className="mt-5 space-y-3">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-canvas"
            >
              Email me a link
            </button>
          </form>
        </>
      )}
    </div>
  );
}
