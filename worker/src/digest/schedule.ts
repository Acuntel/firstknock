export type DigestCadence = "daily" | "weekly_monday";

export interface ScheduleConfig {
  digestHour: number;
  digestMinute: number;
  digestTimezone: string;
  digestCadence: DigestCadence;
  digestPausedUntil?: Date | null;
}

export interface ScheduleDecision {
  due: boolean;
  /** The tenant local date the digest is for, as YYYY-MM-DD. */
  forDate: string;
  /** Plain sentence for the worker log and the sources health page. */
  reason: string;
}

/**
 * How late a digest may run and still be worth sending.
 *
 * The worker polls on a cron, so a missed cycle should still deliver rather than
 * skipping the day. Past this point it stops: a digest labelled "this morning"
 * arriving near midnight is worse than none, and tomorrow's is close behind.
 */
const MAX_LATENESS_HOURS = 12;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  weekday: string;
}

/**
 * The tenant's wall clock time.
 *
 * Tenants pick an hour in their own timezone, and the worker runs in UTC on
 * Railway. Doing this with Intl rather than a date library keeps it dependency
 * free and correct across daylight saving, which matters because Paul's 6:30am
 * has to stay 6:30am in March and November.
 */
export function localParts(now: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    parts[part.type] = part.value;
  }

  // Intl renders midnight as hour 24 in some locales under hour12: false.
  const hour = Number(parts.hour) % 24;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
    weekday: parts.weekday ?? "",
  };
}

/**
 * The UTC instant matching a wall clock time in a tenant's timezone.
 *
 * There is no inverse of Intl.DateTimeFormat, so this converges on the answer:
 * guess that the local time is UTC, read back what that instant actually looks
 * like in the zone, and correct by the difference. Two passes are enough, and the
 * third exists for the twice yearly case where the first correction lands inside
 * a daylight saving shift.
 */
export function zonedTimeToUtc(
  localDate: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const pad = (value: number) => String(value).padStart(2, "0");
  let guess = new Date(`${localDate}T${pad(hour)}:${pad(minute)}:00Z`);

  for (let pass = 0; pass < 3; pass += 1) {
    const local = localParts(guess, timeZone);
    let diff = hour * 60 + minute - (local.hour * 60 + local.minute);

    // The guess can land on the neighbouring day, in which case the minute
    // difference alone points the wrong way round the clock.
    if (local.date < localDate) diff += 1440;
    else if (local.date > localDate) diff -= 1440;

    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 60_000);
  }

  return guess;
}

/**
 * When this tenant's next digest is due.
 *
 * Used by the preview and by the sources health page. Looks forward day by day
 * rather than computing, because the weekly cadence and daylight saving make the
 * arithmetic version easy to get subtly wrong.
 */
export function nextDigestTime(config: ScheduleConfig, now: Date): Date {
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const local = localParts(probe, config.digestTimezone);

    if (config.digestCadence === "weekly_monday" && local.weekday !== WEEKDAYS[1]) {
      continue;
    }

    const candidate = zonedTimeToUtc(
      local.date,
      config.digestHour,
      config.digestMinute,
      config.digestTimezone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }

  // Unreachable for daily and weekly cadences, but a wrong answer here would be
  // an infinite "never due" rather than a visible failure.
  throw new Error(`Could not find a next digest time for cadence ${config.digestCadence}`);
}

/**
 * Whether a tenant is owed a digest right now.
 *
 * `lastSentForDate` is the digest_date of the most recent row in `digests`, which
 * is what stops a second send when the worker runs again ten minutes later.
 */
export function digestDue(
  config: ScheduleConfig,
  now: Date,
  lastSentForDate: string | null,
): ScheduleDecision {
  const local = localParts(now, config.digestTimezone);

  if (config.digestPausedUntil && config.digestPausedUntil.getTime() > now.getTime()) {
    return {
      due: false,
      forDate: local.date,
      reason: `Digests are paused until ${config.digestPausedUntil.toISOString().slice(0, 10)}.`,
    };
  }

  if (config.digestCadence === "weekly_monday" && local.weekday !== WEEKDAYS[1]) {
    return {
      due: false,
      forDate: local.date,
      reason: `This tenant is on a weekly Monday cadence and today is ${local.weekday}.`,
    };
  }

  if (lastSentForDate === local.date) {
    return {
      due: false,
      forDate: local.date,
      reason: "Already sent today.",
    };
  }

  const minutesNow = local.hour * 60 + local.minute;
  const minutesTarget = config.digestHour * 60 + config.digestMinute;
  const target = `${String(config.digestHour).padStart(2, "0")}:${String(config.digestMinute).padStart(2, "0")}`;

  if (minutesNow < minutesTarget) {
    return {
      due: false,
      forDate: local.date,
      reason: `Not yet. This tenant is set to ${target} and it is ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")} for them.`,
    };
  }

  const lateByHours = (minutesNow - minutesTarget) / 60;
  if (lateByHours > MAX_LATENESS_HOURS) {
    return {
      due: false,
      forDate: local.date,
      reason: `Missed by ${Math.round(lateByHours)} hours, past the ${MAX_LATENESS_HOURS} hour cutoff. Skipping rather than sending a morning digest at night.`,
    };
  }

  return {
    due: true,
    forDate: local.date,
    reason:
      lateByHours < 1
        ? `Due at ${target} in ${config.digestTimezone}.`
        : `Due at ${target}, running ${Math.round(lateByHours)} hours late.`,
  };
}
