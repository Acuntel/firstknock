"use client";

import { useState, useTransition } from "react";
import { mailAboutLead } from "@/app/prospects/actions";

/** An envelope, so the button reads as mail before anyone reads the label. */
function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" strokeWidth="1.6" />
      <path d="M3 6l7 5 7-5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor">
      <path d="M4 10.5l4 4 8-9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MailLeadButton({
  prospectId,
  leadId,
  company,
  email,
  trade,
}: {
  prospectId: string;
  leadId: string;
  company: string;
  email: string;
  trade: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const done = result?.ok === true;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted"
      >
        {company.slice(0, 1).toUpperCase()}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{company}</span>
        <span className="block truncate text-xs text-muted">
          {email} &middot; {trade}
        </span>
      </span>

      {result && !result.ok ? (
        <span className="text-xs text-bad">{result.message}</span>
      ) : null}

      <button
        type="button"
        disabled={pending || done}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await mailAboutLead(prospectId, leadId));
          })
        }
        className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[13px] ${
          done ? "btn-quiet" : "btn-primary"
        }`}
      >
        {done ? <TickIcon /> : <EnvelopeIcon />}
        {pending ? "Writing" : done ? "In your inbox" : "Mail"}
      </button>
    </li>
  );
}
