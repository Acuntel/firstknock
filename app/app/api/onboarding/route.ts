import { NextResponse } from "next/server";
import { canAddCounty, planFor, TRIAL_DAYS } from "@firstknock/worker/billing/plans";
import { generateConnectCode } from "@firstknock/worker/telegram/connect";
import { adminDb } from "@/lib/stripe";

export const runtime = "nodejs";

const CONNECT_CODE_TTL_MINUTES = 30;

/**
 * Creates a tenant from the wizard.
 *
 * The county limit is enforced here rather than only in the UI, because the UI
 * is a suggestion and this is the boundary. A tenant who gets four counties onto
 * a Pro plan finds out at 6:30 the next morning, which is the worst possible
 * time to discover a billing problem.
 */
export async function POST(request: Request) {
  let body: {
    name?: string;
    vertical?: string;
    counties?: string[];
    digestTime?: string;
    plan?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const counties = body.counties ?? [];
  if (counties.length === 0) {
    return NextResponse.json({ error: "Pick at least one county." }, { status: 400 });
  }

  let plan;
  try {
    plan = planFor(body.plan ?? "pro");
  } catch {
    return NextResponse.json({ error: "That plan does not exist." }, { status: 400 });
  }

  const limit = canAddCounty(plan, counties.length - 1);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.reason }, { status: 400 });
  }

  const [hour, minute] = (body.digestTime ?? "07:00").split(":");
  const now = new Date();
  const code = generateConnectCode();

  const { data, error } = await adminDb()
    .from("tenants")
    .insert({
      name: body.name?.trim() || "My company",
      plan: plan.id,
      vertical_preset_id: body.vertical ?? "investors",
      counties,
      digest_hour: Number(hour ?? 7),
      digest_minute: Number(minute ?? 0),
      digest_cadence: "daily",
      digest_channels: ["email"],
      hot_ping_threshold: plan.hotPings ? 85 : null,
      trial_ends_at: new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString(),
      subscription_status: "trialing",
      telegram_connect_code: code,
      telegram_connect_expires_at: new Date(
        now.getTime() + CONNECT_CODE_TTL_MINUTES * 60_000,
      ).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "firstknock_leads_bot";

  return NextResponse.json({
    tenantId: data.id,
    // One tap. The bot reads the code out of the deep link payload, so nobody
    // types anything.
    connectUrl: `https://t.me/${bot}?start=${code}`,
  });
}
