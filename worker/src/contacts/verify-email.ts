import { resolveMx } from "node:dns/promises";
import { createConnection } from "node:net";

export type EmailStatus = "verified" | "guessed";

export interface VerificationStep {
  step: "syntax" | "mx" | "smtp";
  passed: boolean;
  detail: string;
  at: string;
}

export interface EmailVerification {
  address: string;
  status: EmailStatus;
  steps: VerificationStep[];
  checkedAt: string;
}

/**
 * Deliberately permissive. Real addresses violate the strict grammar all the
 * time, and this stage exists to reject obvious junk before a DNS lookup, not
 * to adjudicate RFC 5322.
 */
export function syntaxValid(address: string): boolean {
  if (address.length > 254) return false;
  if (/\s/.test(address)) return false;

  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return false;

  const local = address.slice(0, at);
  const domain = address.slice(at + 1);

  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!domain.includes(".")) return false;
  if (domain.startsWith("-") || domain.endsWith("-") || domain.endsWith(".")) return false;
  return /^[A-Za-z0-9.-]+$/.test(domain);
}

async function hasMailExchanger(domain: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const records = await resolveMx(domain);
    if (records.length === 0) {
      return { ok: false, detail: `${domain} publishes no MX records.` };
    }
    const best = [...records].sort((a, b) => a.priority - b.priority)[0];
    return { ok: true, detail: `${domain} accepts mail at ${best?.exchange}.` };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "lookup failed";
    return { ok: false, detail: `No MX for ${domain} (${code}).` };
  }
}

/**
 * Asks the receiving mail server whether it would accept this recipient,
 * without sending anything.
 *
 * The probe opens an SMTP conversation and stops at RCPT TO. Nothing is
 * delivered and no DATA is sent.
 *
 * Outbound port 25 is blocked on most cloud and residential networks, so this
 * frequently cannot run at all. That is handled as unknown, never as a pass:
 * an address whose probe could not complete stays guessed. BUILD_SPEC section 5
 * allows no path where an unproven address is labelled verified.
 */
async function smtpAccepts(
  exchange: string,
  address: string,
  probeFrom: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: exchange, port: 25, timeout: timeoutMs });
    const script = [
      `EHLO ${probeFrom.split("@")[1] ?? "localhost"}`,
      `MAIL FROM:<${probeFrom}>`,
      `RCPT TO:<${address}>`,
    ];
    let stage = -1;
    let settled = false;

    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.on("data", (chunk) => {
      const reply = chunk.toString();
      const code = Number(reply.slice(0, 3));

      if (stage === script.length - 1) {
        // The answer to RCPT TO. 250 and 251 are acceptance.
        finish(
          code === 250 || code === 251,
          code === 250 || code === 251
            ? `${exchange} accepts mail for this address.`
            : `${exchange} answered ${code} for this recipient.`,
        );
        return;
      }

      if (code >= 400) {
        finish(false, `${exchange} answered ${code} before the recipient check.`);
        return;
      }

      stage += 1;
      socket.write(`${script[stage]}\r\n`);
    });

    socket.on("timeout", () =>
      finish(false, `${exchange} did not answer within ${timeoutMs}ms.`),
    );
    socket.on("error", (error) =>
      finish(false, `Could not reach ${exchange}: ${error.message}`),
    );
  });
}

export interface VerifyOptions {
  /** Envelope sender for the probe. Must be a real, monitored address. */
  probeFrom?: string;
  timeoutMs?: number;
  /** Skips the network entirely. Used by tests and by the offline preview. */
  offline?: boolean;
}

/**
 * Runs the chain and labels the address.
 *
 * Verified requires every step to pass. Anything else, including a step that
 * could not run, is guessed. The steps are returned in full so the UI can show
 * why an address carries the label it does rather than asserting it.
 */
export async function verifyEmail(
  address: string,
  options: VerifyOptions = {},
): Promise<EmailVerification> {
  const steps: VerificationStep[] = [];
  const stamp = () => new Date().toISOString();
  const done = (): EmailVerification => ({
    address,
    status: steps.every((step) => step.passed) ? "verified" : "guessed",
    steps,
    checkedAt: stamp(),
  });

  const syntax = syntaxValid(address);
  steps.push({
    step: "syntax",
    passed: syntax,
    detail: syntax ? "Address is well formed." : "Address is not well formed.",
    at: stamp(),
  });
  if (!syntax) return done();

  if (options.offline) {
    steps.push({
      step: "mx",
      passed: false,
      detail: "Offline mode, so the domain was not checked.",
      at: stamp(),
    });
    return done();
  }

  const domain = address.slice(address.lastIndexOf("@") + 1);
  const mx = await hasMailExchanger(domain);
  steps.push({ step: "mx", passed: mx.ok, detail: mx.detail, at: stamp() });
  if (!mx.ok) return done();

  const probeFrom = options.probeFrom ?? process.env.EMAIL_PROBE_FROM;
  if (!probeFrom) {
    steps.push({
      step: "smtp",
      passed: false,
      detail: "No EMAIL_PROBE_FROM configured, so the recipient check was skipped.",
      at: stamp(),
    });
    return done();
  }

  const exchange = mx.detail.slice(mx.detail.lastIndexOf(" ") + 1).replace(/\.$/, "");
  const smtp = await smtpAccepts(exchange, address, probeFrom, options.timeoutMs ?? 8000);
  steps.push({ step: "smtp", passed: smtp.ok, detail: smtp.detail, at: stamp() });
  return done();
}
