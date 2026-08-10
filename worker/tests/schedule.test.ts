import { describe, expect, it } from "vitest";
import {
  digestDue,
  localParts,
  nextDigestTime,
  zonedTimeToUtc,
} from "../src/digest/schedule";

// Chicago is UTC-5 in August (CDT) and UTC-6 in winter (CST). Every instant below
// is written in UTC with the local time it corresponds to in a comment, so a
// failure says which of the two is wrong.
const CHICAGO = "America/Chicago";

function paul(overrides: Partial<Parameters<typeof digestDue>[0]> = {}) {
  return {
    digestHour: 6,
    digestMinute: 30,
    digestTimezone: CHICAGO,
    digestCadence: "daily" as const,
    ...overrides,
  };
}

function realLaw() {
  return {
    digestHour: 8,
    digestMinute: 0,
    digestTimezone: CHICAGO,
    digestCadence: "weekly_monday" as const,
  };
}

describe("tenant local time", () => {
  it("reads the wall clock in the tenant's zone, not the server's", () => {
    // 2026-08-09 is a Sunday.
    const local = localParts(new Date("2026-08-09T11:30:00Z"), CHICAGO);
    expect(local).toEqual({ date: "2026-08-09", hour: 6, minute: 30, weekday: "Sun" });
  });

  it("handles midnight without reporting hour 24", () => {
    const local = localParts(new Date("2026-08-09T05:00:00Z"), CHICAGO);
    expect(local.hour).toBe(0);
    expect(local.date).toBe("2026-08-09");
  });
});

describe("daily cadence", () => {
  it("is not due before the tenant's time", () => {
    // 11:00 UTC is 06:00 in Chicago, half an hour early.
    const decision = digestDue(paul(), new Date("2026-08-09T11:00:00Z"), null);
    expect(decision.due).toBe(false);
    expect(decision.reason).toContain("06:30");
  });

  it("is due at the tenant's time", () => {
    const decision = digestDue(paul(), new Date("2026-08-09T11:30:00Z"), null);
    expect(decision.due).toBe(true);
    expect(decision.forDate).toBe("2026-08-09");
  });

  it("still sends when the worker misses a cycle", () => {
    // 13:00 UTC is 08:00 local, ninety minutes late. Better late than skipped.
    const decision = digestDue(paul(), new Date("2026-08-09T13:00:00Z"), null);
    expect(decision.due).toBe(true);
    expect(decision.reason).toContain("late");
  });

  it("gives up rather than sending a morning digest at night", () => {
    // 01:00 UTC on the 10th is 20:00 local on the 9th, thirteen and a half hours
    // past a 06:30 digest.
    const decision = digestDue(paul(), new Date("2026-08-10T01:00:00Z"), null);
    expect(decision.due).toBe(false);
    expect(decision.reason).toContain("cutoff");
  });

  it("does not send twice on the same local day", () => {
    const decision = digestDue(paul(), new Date("2026-08-09T13:00:00Z"), "2026-08-09");
    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("Already sent today.");
  });

  it("sends again the next day", () => {
    const decision = digestDue(paul(), new Date("2026-08-10T11:30:00Z"), "2026-08-09");
    expect(decision.due).toBe(true);
    expect(decision.forDate).toBe("2026-08-10");
  });
});

describe("weekly Monday cadence", () => {
  it("stays quiet on a Sunday even at the right hour", () => {
    // 13:00 UTC is 08:00 local on Sunday 2026-08-09.
    const decision = digestDue(realLaw(), new Date("2026-08-09T13:00:00Z"), null);
    expect(decision.due).toBe(false);
    expect(decision.reason).toContain("weekly Monday");
  });

  it("sends on Monday at the configured hour", () => {
    const decision = digestDue(realLaw(), new Date("2026-08-10T13:00:00Z"), null);
    expect(decision.due).toBe(true);
    expect(decision.forDate).toBe("2026-08-10");
  });

  it("stays quiet on Monday before the hour", () => {
    const decision = digestDue(realLaw(), new Date("2026-08-10T12:00:00Z"), null);
    expect(decision.due).toBe(false);
    expect(decision.reason).toContain("Not yet");
  });

  it("is quiet every other day of the week", () => {
    for (let day = 11; day <= 15; day += 1) {
      const decision = digestDue(realLaw(), new Date(`2026-08-${day}T13:00:00Z`), null);
      expect(decision.due, `2026-08-${day}`).toBe(false);
    }
  });
});

describe("pausing", () => {
  it("skips a paused tenant even when otherwise due", () => {
    const decision = digestDue(
      paul({ digestPausedUntil: new Date("2026-08-20T00:00:00Z") }),
      new Date("2026-08-09T11:30:00Z"),
      null,
    );
    expect(decision.due).toBe(false);
    expect(decision.reason).toContain("paused");
  });

  it("resumes once the pause has passed", () => {
    const decision = digestDue(
      paul({ digestPausedUntil: new Date("2026-08-01T00:00:00Z") }),
      new Date("2026-08-09T11:30:00Z"),
      null,
    );
    expect(decision.due).toBe(true);
  });
});

describe("converting a wall clock time back to an instant", () => {
  it("resolves a summer morning correctly", () => {
    // CDT, UTC-5.
    expect(zonedTimeToUtc("2026-08-09", 6, 30, CHICAGO).toISOString()).toBe(
      "2026-08-09T11:30:00.000Z",
    );
  });

  it("resolves a winter morning correctly", () => {
    // CST, UTC-6.
    expect(zonedTimeToUtc("2026-01-15", 6, 30, CHICAGO).toISOString()).toBe(
      "2026-01-15T12:30:00.000Z",
    );
  });
});

describe("next digest time", () => {
  it("finds today's send when it has not happened yet", () => {
    const next = nextDigestTime(paul(), new Date("2026-08-09T09:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-09T11:30:00.000Z");
  });

  it("rolls to tomorrow once today's has passed", () => {
    const next = nextDigestTime(paul(), new Date("2026-08-09T15:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-10T11:30:00.000Z");
  });

  it("finds the next Monday for a weekly tenant", () => {
    // From Sunday the 9th, the answer is Monday the 10th at 08:00 local.
    const next = nextDigestTime(realLaw(), new Date("2026-08-09T20:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-10T13:00:00.000Z");
  });

  it("skips a whole week when Monday's send has already gone", () => {
    const next = nextDigestTime(realLaw(), new Date("2026-08-10T14:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-17T13:00:00.000Z");
  });

  it("keeps the tenant's local hour across a daylight saving change", () => {
    // US daylight saving begins on 2026-03-08. Paul asked for 6:30 in the
    // morning, and he means 6:30 on both sides of that weekend even though the
    // UTC offset moves by an hour.
    const before = nextDigestTime(paul(), new Date("2026-03-06T20:00:00Z"));
    const after = nextDigestTime(paul(), new Date("2026-03-08T20:00:00Z"));

    expect(before.toISOString()).toBe("2026-03-07T12:30:00.000Z");
    expect(after.toISOString()).toBe("2026-03-09T11:30:00.000Z");
    expect(localParts(before, CHICAGO).hour).toBe(6);
    expect(localParts(after, CHICAGO).hour).toBe(6);
  });
});
