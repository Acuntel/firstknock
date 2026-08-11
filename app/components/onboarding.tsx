"use client";

import { useState } from "react";
import { TRIAL_DAYS } from "@firstknock/worker/billing/plans";

export interface CountyOption {
  fips: string;
  label: string;
  /** False when we have no adapter for it yet. */
  live: boolean;
}

export interface VerticalOption {
  id: string;
  label: string;
  detail: string;
}

const HOURS = ["06:00", "06:30", "07:00", "07:30", "08:00", "09:00"];

/**
 * The onboarding wizard.
 *
 * The acceptance criterion is a fresh signup reaching a first digest in under
 * ten minutes, so every step here has a working default and nothing blocks on
 * something a person has to go and find. The only step that needs them to leave
 * the page is connecting Telegram, and that is one tap on a deep link.
 */
export function Onboarding({
  verticals,
  counties,
  plan,
}: {
  verticals: VerticalOption[];
  counties: CountyOption[];
  plan: string;
}) {
  const [step, setStep] = useState(0);
  const [vertical, setVertical] = useState(verticals[0]?.id ?? "investors");
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [time, setTime] = useState("07:00");
  const [result, setResult] = useState<{ connectUrl?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = ["Your trade", "Your counties", "Your digest", "Connect Telegram"];

  function toggleCounty(fips: string) {
    setChosen((current) =>
      current.includes(fips) ? current.filter((f) => f !== fips) : [...current, fips],
    );
  }

  async function finish() {
    setBusy(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "My company",
          vertical,
          counties: chosen,
          digestTime: time,
          plan,
        }),
      });
      const body = await response.json();
      setResult(response.ok ? { connectUrl: body.connectUrl } : { error: body.error });
      setStep(3);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Something went wrong." });
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <ol className="mb-8 flex flex-wrap gap-2 text-xs">
        {steps.map((label, index) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${
              index === step
                ? "bg-brand text-canvas"
                : index < step
                  ? "bg-ok-bg text-ok"
                  : "bg-surface-2 text-muted"
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section>
          <h1 className="text-2xl font-semibold">What do you do?</h1>
          <p className="mt-1 text-sm text-muted">
            This sets how every filing is scored. You can change the weights later.
          </p>
          <div className="mt-5 space-y-2">
            {verticals.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setVertical(option.id)}
                className={`block w-full rounded-lg border px-4 py-3 text-left ${
                  vertical === option.id ? "border-brand bg-surface" : "border-line bg-surface"
                }`}
              >
                <span className="font-medium">{option.label}</span>
                <span className="mt-0.5 block text-sm text-muted">{option.detail}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mt-6 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-canvas"
          >
            Next
          </button>
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <h1 className="text-2xl font-semibold">Which counties?</h1>
          <p className="mt-1 text-sm text-muted">
            Pick where you work. Counties we are still building are shown so you know
            what is coming, and you can select one to be told when it goes live.
          </p>
          <div className="mt-5 space-y-2">
            {counties.map((county) => (
              <label
                key={county.fips}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(county.fips)}
                  onChange={() => toggleCounty(county.fips)}
                />
                <span className="flex-1">{county.label}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs ${
                    county.live ? "bg-ok-bg text-ok" : "bg-idle-bg text-idle"
                  }`}
                >
                  {county.live ? "live" : "coming"}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-lg border border-line-strong px-4 py-2.5 text-sm"
            >
              Back
            </button>
            <button
              type="button"
              disabled={chosen.length === 0}
              onClick={() => setStep(2)}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-canvas disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h1 className="text-2xl font-semibold">When do you want it?</h1>
          <p className="mt-1 text-sm text-muted">
            Your digest arrives at this time every morning, Central.
          </p>

          <label className="mt-5 block text-sm font-medium">
            Company name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pilot Roofing"
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            {HOURS.map((hour) => (
              <button
                key={hour}
                type="button"
                onClick={() => setTime(hour)}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  time === hour ? "border-brand text-brand" : "border-line text-muted"
                }`}
              >
                {hour}
              </button>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-line-strong px-4 py-2.5 text-sm"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={finish}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-canvas disabled:opacity-60"
            >
              {busy ? "Setting up" : "Finish setup"}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section>
          {result?.error ? (
            <>
              <h1 className="text-2xl font-semibold">That did not go through</h1>
              <p className="mt-2 rounded-lg border border-bad-bg bg-bad-bg px-4 py-3 text-sm text-bad">
                {result.error}
              </p>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mt-5 rounded-lg border border-line-strong px-4 py-2.5 text-sm"
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">You are set up</h1>
              <p className="mt-2 text-sm text-muted">
                Your first digest arrives tomorrow at {time}. Connect Telegram now and
                you will get it there as well as by email, plus instant pings on
                anything that scores high.
              </p>

              {result?.connectUrl ? (
                <a
                  href={result.connectUrl}
                  className="mt-5 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-canvas"
                >
                  Connect Telegram
                </a>
              ) : null}

              <p className="mt-4 text-sm text-muted">
                Nothing is charged for {TRIAL_DAYS} days. You can change your counties,
                your time, and how every filing is scored from settings.
              </p>

              <a href="/today" className="mt-6 block text-sm text-brand">
                Go to today's leads
              </a>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
