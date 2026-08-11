import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { ALL_TENANTS } from "./tenants";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Mints a sign in link for a person and joins them to tenants.
 *
 * Onboarding a design partner cannot depend on transactional email working.
 * Supabase's built in SMTP is rate limited to a couple of messages an hour and
 * is not meant for production, so during setup the more reliable path is to
 * generate the link here and hand it over directly.
 *
 * Usage:
 *   pnpm --filter worker invite brady@example.com pilot,paul
 *   pnpm --filter worker invite brady@example.com all
 */
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

function usage(message: string): never {
  process.stderr.write(
    `${message}\n\n` +
      `Usage: pnpm --filter worker invite <email> <tenant-keys|all>\n` +
      `Tenants: ${ALL_TENANTS.map((t) => t.key).join(", ")}\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [email, keysArg] = process.argv.slice(2);
  if (!email || !email.includes("@")) usage("Give an email address.");
  if (!keysArg) usage("Say which tenants this person belongs to.");

  const wanted =
    keysArg === "all"
      ? ALL_TENANTS.map((t) => t.key)
      : keysArg.split(",").map((k) => k.trim()).filter(Boolean);

  const unknown = wanted.filter(
    (k) => !ALL_TENANTS.some((t) => t.key === k),
  );
  if (unknown.length > 0) usage(`Unknown tenant: ${unknown.join(", ")}`);

  const admin = createWorkerClient();

  // Reuse the account if it exists. Creating a second one would silently split
  // a person's memberships across two identities.
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw new Error(`Could not list users: ${listError.message}`);

  let user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not create ${email}: ${error.message}`);
    user = data.user;
    process.stdout.write(`Created account for ${email}\n`);
  } else {
    process.stdout.write(`Account already existed for ${email}\n`);
  }

  const { data: tenants, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, fixture_key")
    .in("fixture_key", wanted);
  if (tenantError) throw new Error(`Could not read tenants: ${tenantError.message}`);

  const missing = wanted.filter(
    (k) => !(tenants ?? []).some((t) => t.fixture_key === k),
  );
  if (missing.length > 0) {
    process.stdout.write(
      `Not in the database yet, run seed-tenants first: ${missing.join(", ")}\n`,
    );
  }

  for (const tenant of tenants ?? []) {
    const { error } = await admin
      .from("members")
      .upsert(
        { tenant_id: tenant.id, user_id: user.id, role: "owner" },
        { onConflict: "tenant_id,user_id" },
      );
    process.stdout.write(
      `  ${error ? `FAILED ${tenant.name}: ${error.message}` : `owner of ${tenant.name}`}\n`,
    );
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw new Error(`Could not mint a link: ${linkError.message}`);

  // The hash, not the action_link. The action link routes through Supabase's
  // verify endpoint, which hands the session back in a URL fragment that a
  // server never sees. Verifying the hash ourselves keeps it server side.
  const url = `${APP_URL}/auth/callback?token_hash=${link.properties.hashed_token}&type=email`;
  process.stdout.write(`\nSign in link, single use, expires in 1 hour:\n${url}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
