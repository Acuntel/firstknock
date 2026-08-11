import Link from "next/link";
import { PLANS, TRIAL_DAYS } from "@firstknock/worker/billing/plans";

export const metadata = {
  title: "FirstKnock",
  description:
    "County public records, scored and delivered every morning. Know who in your county needs your service today.",
};

const STEPS = [
  {
    n: "1",
    title: "We watch your county",
    body: "Foreclosure filings, tax delinquencies, building permits, fire incidents, property sales. Every public record in the counties you cover, pulled the moment the county publishes it.",
  },
  {
    n: "2",
    title: "Every filing gets scored",
    body: "The same filing means different things to different trades. A new lis pendens is a 20 to a restoration company and an 85 to an investor. You get your number, and you can see exactly how it was reached.",
  },
  {
    n: "3",
    title: "You get a morning list",
    body: "The top leads in your counties, at the hour you choose, on Telegram or by email. Each one comes with the owner's contact details and a draft you can send, a letter you can mail, or a script for the door.",
  },
];

const VERTICALS = [
  { name: "Restoration", detail: "Fire and water losses, repair permits" },
  { name: "Investors", detail: "Lis pendens, judgments, tax delinquency" },
  { name: "Roofing and HVAC", detail: "Permits, sales, storm adjacent filings" },
  { name: "Law firms", detail: "New foreclosure filings, association registrations" },
];

function PlanCard({ id }: { id: keyof typeof PLANS }) {
  const plan = PLANS[id];
  const included = [
    plan.maxCounties === null
      ? "Unlimited counties in one state"
      : `${plan.maxCounties} ${plan.maxCounties === 1 ? "county" : "counties"}`,
    `${plan.maxSeats} ${plan.maxSeats === 1 ? "seat" : "seats"}`,
    "Daily digest on Telegram or email",
    plan.hotPings ? "Instant pings on high scores" : null,
    plan.emailDrafts ? "Email drafts written for you" : null,
    plan.letters ? "Mailed letters, one tap" : null,
    plan.csvExport ? "CSV and API export" : null,
  ].filter((line): line is string => line !== null);

  return (
    <div
      className={`rounded-xl border bg-surface p-6 ${
        id === "pro" ? "border-brand" : "border-line"
      }`}
    >
      <p className="text-sm font-medium text-muted">{plan.label}</p>
      <p className="mt-1 text-3xl font-semibold">
        ${plan.monthlyCents / 100}
        <span className="text-base font-normal text-muted"> per month</span>
      </p>
      <ul className="mt-4 space-y-1.5 text-sm">
        {included.map((line) => (
          <li key={line} className="flex gap-2">
            {/* The literal character, not the &check; entity: the JSX
                transform leaves that one undecoded and it prints as text. */}
            <span className="text-ok" aria-hidden="true">
              ✓
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <Link
        href={`/onboarding?plan=${plan.id}`}
        className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-medium ${
          id === "pro"
            ? "bg-brand text-canvas"
            : "border border-line-strong text-ink hover:bg-surface-2"
        }`}
      >
        Start {TRIAL_DAYS} day trial
      </Link>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold">FirstKnock</span>
        <Link href="/today" className="text-sm text-muted hover:text-ink">
          Sign in
        </Link>
      </header>

      <section className="py-16">
        <h1 className="text-5xl font-semibold tracking-tight">Know first. Knock first.</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          FirstKnock watches the public records in your county and tells you who
          needs your service today, before your competitors know their name.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/onboarding?plan=pro"
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-canvas"
          >
            Start your {TRIAL_DAYS} day trial
          </Link>
          <Link
            href="#how"
            className="rounded-lg border border-line-strong px-5 py-2.5 text-sm font-medium"
          >
            See how it works
          </Link>
        </div>
        <p className="mt-3 text-sm text-muted">
          Card required, nothing charged for {TRIAL_DAYS} days, cancel any time.
        </p>
      </section>

      {/* The loop in three steps, which is what the spec asks the landing page
          to do above everything else. */}
      <section id="how" className="border-t border-line py-14">
        <h2 className="text-xs uppercase tracking-wide text-muted">How it works</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">
                {step.n}
              </span>
              <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line py-14">
        <h2 className="text-xs uppercase tracking-wide text-muted">Built for</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {VERTICALS.map((vertical) => (
            <div key={vertical.name} className="rounded-lg border border-line bg-surface px-4 py-3">
              <p className="font-medium">{vertical.name}</p>
              <p className="text-sm text-muted">{vertical.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 max-w-2xl text-sm text-muted">
          Every trade reads the same records differently, so the scoring is tuned
          per vertical and then tuned again for you. You can see the reasoning
          behind every score and change the weights yourself.
        </p>
      </section>

      <section className="border-t border-line py-14">
        <h2 className="text-xs uppercase tracking-wide text-muted">Pricing</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <PlanCard id="solo" />
          <PlanCard id="pro" />
          <PlanCard id="team" />
        </div>
      </section>

      <section className="border-t border-line py-14">
        <h2 className="text-xs uppercase tracking-wide text-muted">How we contact people</h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
          Every message is drafted for you and sent by you. FirstKnock never sends
          anything on its own. Emails carry your identity and an unsubscribe line,
          there is no auto dialer, and we do not send cold text messages. The
          records we read are public, and we tell the recipient that.
        </p>
      </section>

      <footer className="border-t border-line pt-8 text-sm text-muted">
        <p>FirstKnock. Know first. Knock first.</p>
      </footer>
    </div>
  );
}
