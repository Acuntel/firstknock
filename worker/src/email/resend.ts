export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Appended to both bodies. Required for the law firm's bar disclaimer. */
  footer?: string | null;
}

const FROM = process.env.RESEND_FROM ?? "FirstKnock <digests@firstknock.app>";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Sends through Resend's HTTP API directly rather than the SDK.
 *
 * One POST does not justify a dependency, and it keeps the worker's install
 * small for Railway.
 *
 * CAN-SPAM identity and the tenant's compliance footer are appended here rather
 * than in compose, so no caller can accidentally send a template without them.
 */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set. Copy env.example to .env.");

  const footer = message.footer?.trim();
  const text = footer ? `${message.text}\n\n${footer}` : message.text;
  const html = footer
    ? `${message.html}\n<p style="font:12px system-ui,sans-serif;color:#5c626d;margin-top:20px">${footer}</p>`
    : message.html;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [message.to], subject: message.subject, text, html }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend returned ${response.status}: ${body.slice(0, 300)}`);
  }
}
