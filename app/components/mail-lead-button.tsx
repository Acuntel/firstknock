"use client";

import { useState, useTransition } from "react";
import { mailAboutLead } from "@/app/prospects/actions";

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

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
      <span className="w-52 shrink-0 truncate text-sm">{company}</span>
      <span className="w-56 shrink-0 truncate text-sm text-muted">{email}</span>
      <span className="w-40 shrink-0 truncate text-xs text-muted">{trade}</span>

      <button
        type="button"
        disabled={pending || result?.ok === true}
        onClick={() =>
          start(async () => {
            setResult(null);
            const outcome = await mailAboutLead(prospectId, leadId);
            setResult(outcome);
          })
        }
        className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
      >
        {pending ? "Writing" : result?.ok ? "In your drafts" : "Mail"}
      </button>

      {result && !result.ok ? (
        <span className="text-xs text-idle">{result.message}</span>
      ) : null}
    </li>
  );
}
