import { propertyCategory } from "./class-fit";
import type {
  ScorableEvent,
  ScoreBreakdown,
  ScoreComponent,
  ScoringTenant,
} from "./types";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const EARTH_RADIUS_MILES = 3958.7613;

function component(
  kind: ScoreComponent["kind"],
  value: number,
  explanation: string,
  available = true,
): ScoreComponent {
  return { kind, value, explanation, available };
}

/** Town names compare case and whitespace insensitively. */
function normalizeTown(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeAddress(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .toUpperCase();
}

function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Scores one event for one tenant.
 *
 * Deterministic by construction. `now` is a required argument rather than a
 * call to the clock, which is what makes "the same event and config produce a
 * bit identical score" testable at all: with a hidden clock the freshness term
 * changes on every run and the property cannot be asserted.
 *
 * No LLM is involved, per BUILD_SPEC section 4. Every number here is arithmetic
 * on the tenant's stored weights, and every term records whether it actually
 * had data, so the lead detail view can explain a score rather than assert it.
 */
export function scoreEvent(
  event: ScorableEvent,
  tenant: ScoringTenant,
  now: Date,
): ScoreBreakdown {
  const weights = tenant.weights;
  const signals = event.signals ?? {};

  // --- Town exclusion ----------------------------------------------------
  // A tenant level knob, not a preset one. Vince excludes Bellwood for village
  // inspector reasons that have nothing to do with the investor vertical.
  const town = event.property.city;
  const excludedTown = town
    ? tenant.excludedTowns.find((t) => normalizeTown(t) === normalizeTown(town))
    : undefined;

  // --- Severity ----------------------------------------------------------
  const severity = weights.eventSeverity[event.type] ?? 0;
  const severityComponent = component(
    "base",
    severity,
    severity > 0
      ? `${event.type} is worth ${severity} points before any adjustment for this vertical.`
      : `${event.type} carries no weight in this vertical.`,
    severity > 0,
  );

  // --- Freshness ---------------------------------------------------------
  const halfLife =
    weights.freshnessHalfLifeByType?.[event.type] ?? weights.freshnessHalfLifeHours;
  const ageHours = Math.max(0, (now.getTime() - event.occurredAt.getTime()) / MS_PER_HOUR);
  const freshness = 2 ** (-ageHours / halfLife);
  const freshnessComponent = component(
    "multiplier",
    freshness,
    `${Math.round(ageHours)} hours old against a ${halfLife} hour half life, so it keeps ${Math.round(freshness * 100)} percent of its value.`,
  );

  // --- Property class fit ------------------------------------------------
  const category = propertyCategory(
    event.fips,
    event.property.class,
    event.property.category,
  );
  const classFit = weights.propertyClassFit[category] ?? weights.propertyClassFit.unknown ?? 1;
  const classComponent = component(
    "multiplier",
    classFit,
    category === "unknown"
      ? "No property class on this record, so class fit stays neutral."
      : `Classed as ${category}, which this vertical weights at ${classFit}.`,
    category !== "unknown",
  );

  // --- Distance from the service area ------------------------------------
  // Outside the radius decays rather than disappearing: a large commercial loss
  // 40 miles out can still be worth a ping.
  let distance = 1;
  let distanceComponent = component(
    "multiplier",
    1,
    "No coordinates on this record, so distance stays neutral.",
    false,
  );

  const area = tenant.serviceArea;
  const { lat, lng } = event.property;
  if (area && typeof lat === "number" && typeof lng === "number") {
    const miles = haversineMiles(area.lat, area.lng, lat, lng);
    const beyond = Math.max(0, miles - area.radiusMiles);
    distance = 2 ** (-beyond / weights.distanceDecayMiles);
    distanceComponent = component(
      "multiplier",
      distance,
      beyond === 0
        ? `${miles.toFixed(1)} miles out, inside the ${area.radiusMiles} mile service area.`
        : `${miles.toFixed(1)} miles out, ${beyond.toFixed(1)} beyond the service area, so it keeps ${Math.round(distance * 100)} percent of its value.`,
    );
  }

  // --- Foreclosure stage -------------------------------------------------
  // Z's whole thesis: how long until the sheriff sale matters more than how
  // recently the filing appeared.
  let stage = 1;
  let stageComponent = component("multiplier", 1, "Not a staged foreclosure event.", false);

  const stageConfig = weights.foreclosureStage;
  if (stageConfig?.enabled && signals.auctionDate) {
    const daysToSale = (signals.auctionDate.getTime() - now.getTime()) / MS_PER_DAY;
    if (daysToSale < 0) {
      stage = stageConfig.pastSaleMultiplier;
      stageComponent = component(
        "multiplier",
        stage,
        `The auction was ${Math.abs(Math.round(daysToSale))} days ago, so this is mostly historical.`,
      );
    } else {
      const window = stageConfig.windows.find((w) => daysToSale <= w.maxDaysToSale);
      stage = window?.multiplier ?? 1;
      stageComponent = component(
        "multiplier",
        stage,
        window
          ? `${Math.round(daysToSale)} days to auction, inside the ${window.maxDaysToSale} day window.`
          : `${Math.round(daysToSale)} days to auction, beyond every stage window.`,
      );
    }
  }

  // --- Absentee owner ----------------------------------------------------
  // Fires only on an owner party carrying its own mailing address. Cook permits
  // name an applicant, who is often the contractor, so this stays neutral there
  // rather than inferring absence from a builder's office address.
  const bonusRate = weights.absenteeOwnerBonus ?? 0;
  let absentee = 1;
  let absenteeComponent = component(
    "multiplier",
    1,
    bonusRate === 0
      ? "This vertical does not weight absentee owners."
      : "No owner mailing address on this record, so absentee status is unknown.",
    false,
  );

  if (bonusRate > 0) {
    const owner = event.parties.find((p) => p.role === "owner" && p.address);
    const propertyAddress = event.property.address;
    if (owner?.address && propertyAddress) {
      const isAbsentee =
        normalizeAddress(owner.address) !== normalizeAddress(propertyAddress);
      absentee = isAbsentee ? 1 + bonusRate : 1;
      absenteeComponent = component(
        "multiplier",
        absentee,
        isAbsentee
          ? "The owner's mailing address differs from the property, which reads as absentee."
          : "The owner receives mail at the property, so they are likely owner occupied.",
      );
    }
  }

  // --- Value gap ---------------------------------------------------------
  let valueGapPoints = 0;
  let valueGapComponent = component(
    "bonus",
    0,
    "No assessed value on this record, so no value gap could be computed.",
    false,
  );

  const { assessedValue, lastSalePrice } = signals;
  if (
    weights.valueGap > 0 &&
    typeof assessedValue === "number" &&
    typeof lastSalePrice === "number" &&
    assessedValue > 0
  ) {
    const gap = Math.min(1, Math.max(0, (assessedValue - lastSalePrice) / assessedValue));
    valueGapPoints = weights.valueGap * 100 * gap;
    valueGapComponent = component(
      "bonus",
      valueGapPoints,
      `Assessed at ${Math.round(gap * 100)} percent above the last sale, worth ${valueGapPoints.toFixed(1)} extra points.`,
    );
  }

  // --- Combine -----------------------------------------------------------
  const raw = severity * freshness * classFit * distance * stage * absentee + valueGapPoints;
  const score = excludedTown ? 0 : Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score,
    excluded: Boolean(excludedTown),
    excludedReason: excludedTown
      ? `${excludedTown} is on this tenant's excluded town list.`
      : null,
    components: {
      severity: severityComponent,
      freshness: freshnessComponent,
      propertyClass: classComponent,
      distance: distanceComponent,
      foreclosureStage: stageComponent,
      absenteeOwner: absenteeComponent,
      valueGap: valueGapComponent,
    },
    scoredAt: now.toISOString(),
    presetId: tenant.verticalPresetId,
  };
}

/**
 * Ranks events for one tenant, dropping anything excluded outright.
 *
 * Generic over the event type so callers keep whatever they passed in. A caller
 * handing over full PropertyEvent records gets them back intact rather than
 * narrowed to the subset scoring happens to read.
 */
export function rankForTenant<T extends ScorableEvent>(
  events: T[],
  tenant: ScoringTenant,
  now: Date,
): Array<{ event: T; breakdown: ScoreBreakdown }> {
  return events
    .map((event) => ({ event, breakdown: scoreEvent(event, tenant, now) }))
    .filter((row) => !row.breakdown.excluded)
    .sort((a, b) => {
      if (b.breakdown.score !== a.breakdown.score) {
        return b.breakdown.score - a.breakdown.score;
      }
      // Stable tiebreak so a ranked list is reproducible run to run.
      return b.event.occurredAt.getTime() - a.event.occurredAt.getTime();
    });
}
