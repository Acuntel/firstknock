export function ScoreBadge({
  score,
  threshold,
}: {
  score: number;
  threshold: number;
}) {
  // Colour tracks the tenant's own ping threshold rather than a fixed scale,
  // because 70 is a hot lead for the roofer and unremarkable for the law firm.
  const tone =
    score >= threshold
      ? "bg-ok-bg text-ok"
      : score >= threshold * 0.6
        ? "bg-warn-bg text-warn"
        : "bg-idle-bg text-idle";

  return (
    <span
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums ${tone}`}
      title={
        score >= threshold
          ? `At or above the ${threshold} ping threshold`
          : `Below the ${threshold} ping threshold`
      }
    >
      {score}
    </span>
  );
}
