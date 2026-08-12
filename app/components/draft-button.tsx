"use client";

import { useState, useTransition } from "react";
import { draftEmails, type DraftResult } from "@/app/prospects/actions";

export function DraftButton({ ready }: { ready: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DraftResult | null>(null);

  const count = Math.min(ready, 10);

  return (
    <div>
      <button
        type="button"
        disabled={pending || ready === 0}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await draftEmails(count));
          })
        }
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending
          ? "Writing drafts, this takes a few seconds each"
          : ready === 0
            ? "Nothing ready to draft"
            : `Write ${count} draft${count === 1 ? "" : "s"}`}
      </button>

      <p className="mt-2 text-xs text-muted">
        Drafts land in your own mailbox. Nothing is ever sent for you, so read
        each one before it goes.
      </p>

      {result ? (
        <div className="mt-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          {result.error ? (
            <p className="text-ink">{result.error}</p>
          ) : (
            <p className="text-ink">
              {result.drafted} draft{result.drafted === 1 ? "" : "s"} waiting in your
              Drafts folder.
            </p>
          )}
          {/* Naming what was skipped and why, because a button that reports
              three of five with no explanation reads as broken. */}
          {result.skipped.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {result.skipped.map((item) => (
                <li key={item.company}>
                  Skipped {item.company}: {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
