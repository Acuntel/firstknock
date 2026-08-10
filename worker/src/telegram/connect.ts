import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Codes live long enough to walk from the settings page to Telegram. */
export const CONNECT_CODE_TTL_MINUTES = 30;

// No look alike characters. These get read off a screen and retyped in group
// chats, where an l against a 1 costs a support message.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * A single use connect code.
 *
 * TELEGRAM_SETUP.md calls for a short lived random code. Both properties matter:
 * whoever holds this code can point a chat at the tenant and start receiving its
 * leads, so it expires and it is cleared the moment it is used.
 */
export function generateConnectCode(): string {
  const bytes = randomBytes(12);
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

export interface ConnectResult {
  ok: boolean;
  tenantName?: string;
  /** Sent straight back to the chat, so it has to read well. */
  message: string;
}

/**
 * Points a chat at a tenant.
 *
 * Chat ids are stored as text because group ids are negative and large. The code
 * is cleared on success so it cannot be replayed by anyone who saw it in the
 * group's scrollback.
 */
export async function connectChat(
  client: SupabaseClient,
  code: string,
  chatId: string,
  now: Date,
): Promise<ConnectResult> {
  const { data, error } = await client
    .from("tenants")
    .select("id, name, telegram_connect_expires_at")
    .eq("telegram_connect_code", code)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up connect code: ${error.message}`);

  if (!data) {
    return {
      ok: false,
      message: "That code is not valid. Generate a new one from your settings page.",
    };
  }

  const expiresAt = data.telegram_connect_expires_at
    ? new Date(String(data.telegram_connect_expires_at))
    : null;

  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      message: "That code has expired. Generate a new one from your settings page.",
    };
  }

  const { error: updateError } = await client
    .from("tenants")
    .update({
      telegram_chat_id: chatId,
      telegram_connect_code: null,
      telegram_connect_expires_at: null,
    })
    .eq("id", data.id);

  if (updateError) throw new Error(`Failed to connect chat: ${updateError.message}`);

  return {
    ok: true,
    tenantName: String(data.name),
    message: `Connected to ${data.name}. Your digest will arrive here from now on.`,
  };
}

/** Mints a fresh code for the settings page to render into a deep link. */
export async function issueConnectCode(
  client: SupabaseClient,
  tenantId: string,
  now: Date,
): Promise<string> {
  const code = generateConnectCode();
  const expiresAt = new Date(now.getTime() + CONNECT_CODE_TTL_MINUTES * 60_000);

  const { error } = await client
    .from("tenants")
    .update({
      telegram_connect_code: code,
      telegram_connect_expires_at: expiresAt.toISOString(),
    })
    .eq("id", tenantId);

  if (error) throw new Error(`Failed to issue connect code: ${error.message}`);
  return code;
}
