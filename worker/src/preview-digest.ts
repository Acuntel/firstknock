import { config as loadEnv } from "dotenv";
import { composeDigest, composeHotPing } from "./digest/compose";
import { fixtureEvents } from "./fixture-events";
import { digestDue, nextDigestTime } from "./digest/schedule";
import { fixtureLeadId } from "./lead-id";
import { loadPreset } from "./scoring/presets";
import { rankForTenant } from "./scoring/score";
import { ALL_TENANTS, toScoringTenant } from "./tenants";
import type { CountyAdapter, PropertyEvent, RawRecord } from "./types";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Renders every design partner's digest without sending anything.
 *
 * The Phase 3 acceptance criteria need a real Telegram bot token, which does not
 * exist yet. This is the reviewable stand in: real fixtures, the real scoring
 * engine, the real schedule decision, and the real message composer, printed to
 * the terminal. It reaches no network and no database.
 *
 * Pass an ISO timestamp to see a different moment, which is how you check that
 * REAL Law only gets a digest on Monday:
 *
 *   pnpm digest:preview 2026-08-10T13:05:00Z
 */
const at = process.argv[2] ? new Date(process.argv[2]) : new Date();
if (Number.isNaN(at.getTime())) {
  process.stderr.write(`Could not read "${process.argv[2]}" as a timestamp.\n`);
  process.exit(1);
}

const events = fixtureEvents();

/** Telegram HTML is for Telegram. The terminal wants the words. */
function plain(html: string): string {
  return html
    .replace(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g, "$2 [$1]")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

const out = (line = "") => process.stdout.write(`${line}\n`);

out(`FirstKnock digest preview at ${at.toISOString()}`);
out(`${events.length} Cook County fixture events, scored live. Nothing is sent.`);

for (const partner of ALL_TENANTS) {
  const preset = loadPreset(partner.verticalPresetId);
  const decision = digestDue(
    {
      digestHour: partner.digestHour,
      digestMinute: partner.digestMinute,
      digestTimezone: "America/Chicago",
      digestCadence: partner.digestCadence,
    },
    at,
    null,
  );

  const ranked = rankForTenant(events, toScoringTenant(partner), at)
    .filter((row) => row.breakdown.score > 0)
    .slice(0, preset.digest.topN)
    .map((row) => ({
      // The same id the app derives in fixture mode, so these links resolve.
      id: fixtureLeadId(row.event),
      score: row.breakdown.score,
      event: row.event,
    }));

  const next = nextDigestTime(
    {
      digestHour: partner.digestHour,
      digestMinute: partner.digestMinute,
      digestTimezone: "America/Chicago",
      digestCadence: partner.digestCadence,
    },
    at,
  );

  out();
  out("=".repeat(72));
  out(`${partner.name}  (${partner.verticalPresetId}, ${partner.digestCadence})`);
  out(`Channels: ${partner.digestChannels.join(" and ")}`);
  out(`Schedule: ${decision.due ? "DUE NOW" : "not due"}. ${decision.reason}`);
  out(`Next digest: ${next.toISOString()}`);
  out("=".repeat(72));

  if (ranked.length === 0) {
    out("No leads score above zero for this configuration from the fixture events.");
    continue;
  }

  const composeInput = {
    tenantName: partner.name,
    counties: partner.counties,
    leadNoun: preset.digest.leadNoun,
    subjectTemplate: preset.digest.subject,
    leads: ranked,
    appUrl: process.env.APP_URL ?? "http://localhost:3100",
    tenantKey: partner.key,
    now: at,
  };

  const content = composeDigest(composeInput);
  out();
  out(`Subject: ${content.subject}`);
  out(`Telegram messages: ${content.telegram.length}`);
  out();
  for (const message of content.telegram) out(plain(message));

  const hot = ranked.filter((lead) => lead.score >= partner.hotPingThreshold);
  out();
  if (hot.length === 0) {
    out(`Hot pings: none. Nothing reached the ${partner.hotPingThreshold} threshold.`);
  } else {
    out(`Hot pings: ${hot.length} at or above ${partner.hotPingThreshold}.`);
    out();
    out(plain(composeHotPing(composeInput, hot[0]!, partner.hotPingThreshold).telegram));
  }
}

out();
