"use client";

import { useState, useTransition } from "react";
import { importProspects, type ImportResult } from "@/app/prospects/actions";

export interface Option {
  value: string;
  label: string;
}

const STATUS_NOTE: Record<string, string> = {
  added: "contactable",
  "no email": "no address published",
  unverified: "address found but not provable",
  unreadable: "site did not load",
  duplicate: "already had them",
};

export function ImportForm({ markets, segments }: { markets: Option[]; segments: Option[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [text, setText] = useState("");
  const [fips, setFips] = useState(markets[0]?.value ?? "");
  const [segment, setSegment] = useState(segments[0]?.value ?? "");

  const added = result?.outcomes.filter((o) => o.status === "added").length ?? 0;

  return (
    <div className="card p-5">
      <h2 className="text-[15px] font-semibold">Add companies</h2>
      <p className="mt-1 text-xs text-muted">
        Paste their websites, one per line or straight out of a search results
        page. Anything that is not a web address is ignored.
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        placeholder={"https://example-roofing.com\nanother-contractor.com"}
        className="mt-3 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 font-mono text-xs"
      />

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-xs text-muted">
          Market
          <select
            value={fips}
            onChange={(event) => setFips(event.target.value)}
            className="ml-2 rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink"
          >
            {markets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-muted">
          What they do
          <select
            value={segment}
            onChange={(event) => setSegment(event.target.value)}
            className="ml-2 rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink"
          >
            {segments.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        disabled={pending || text.trim() === ""}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await importProspects(text, fips, segment));
          })
        }
        className="btn-primary mt-3 px-4 py-2 text-sm"
      >
        {pending ? "Reading their sites, this takes a minute or two" : "Find their contact details"}
      </button>

      {result ? (
        <div className="mt-4 border-t border-line pt-3 text-sm">
          {result.error ? (
            <p>{result.error}</p>
          ) : (
            <p>
              {added} of {result.outcomes.length} sites gave a contactable address.
            </p>
          )}

          {/* Every site is listed with what happened to it. Most yield nothing,
              and a run that reports two from twelve with no detail looks broken
              rather than normal. */}
          {result.outcomes.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {result.outcomes.map((outcome) => (
                <li key={outcome.url}>
                  {outcome.company ?? outcome.url}: {STATUS_NOTE[outcome.status] ?? outcome.status}
                  {outcome.email ? `, ${outcome.email}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          {result.notAttempted > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {result.notAttempted} more were left for a second run, so this one
              did not take all day. Paste them again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
