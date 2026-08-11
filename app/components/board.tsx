"use client";

import Link from "next/link";
import { useState } from "react";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/lead-status";

export interface BoardCard {
  id: string;
  title: string;
  subtitle: string;
  score: number;
  status: LeadStatus;
}

const COLUMN_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  responded: "Responded",
  won: "Won",
  lost: "Lost",
};

export function Board({
  cards,
  tenantKey,
  fixtureMode,
}: {
  cards: BoardCard[];
  tenantKey: string;
  fixtureMode: boolean;
}) {
  const [items, setItems] = useState(cards);
  const [dragging, setDragging] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function move(id: string, status: LeadStatus) {
    const card = items.find((item) => item.id === id);
    if (!card || card.status === status) return;

    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );

    // Honest about what just happened. Without a database there is nowhere to
    // write this, and a card that silently springs back on refresh would be
    // worse than saying so.
    setNotice(
      fixtureMode
        ? `Moved ${card.title} to ${COLUMN_LABELS[status]}. Not saved: connect Supabase to persist status changes.`
        : `Moved ${card.title} to ${COLUMN_LABELS[status]}.`,
    );
  }

  return (
    <>
      {notice ? (
        <p className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-muted">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-5">
        {LEAD_STATUSES.map((status) => {
          const column = items.filter((item) => item.status === status);
          return (
            <section
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging) move(dragging, status);
                setDragging(null);
              }}
              className="rounded-lg border border-line bg-surface-2 p-2"
            >
              <h2 className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-muted">
                {COLUMN_LABELS[status]} <span className="tabular-nums">{column.length}</span>
              </h2>

              <ul className="space-y-2">
                {column.map((card) => (
                  <li
                    key={card.id}
                    draggable
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`rounded-md border border-line bg-surface p-2.5 ${
                      dragging === card.id ? "opacity-50" : ""
                    }`}
                  >
                    <Link href={`/leads/${card.id}?tenant=${tenantKey}`} className="block">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{card.title}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">
                          {card.score}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {card.subtitle}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
