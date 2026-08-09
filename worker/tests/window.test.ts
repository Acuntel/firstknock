import { describe, expect, it } from "vitest";
import { FUTURE_TOLERANCE_DAYS, windowStart, withoutFutureDates } from "../src/window";
import { allAdapters } from "../src/registry";
import { cookSalesAdapter } from "../src/adapters/cook-socrata";
import type { PropertyEvent } from "../src/types";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function event(occurredAt: string): PropertyEvent {
  return {
    fips: "17031",
    type: "PERMIT",
    occurredAt: new Date(occurredAt),
    externalId: occurredAt,
    property: {},
    parties: [],
    raw: {},
  };
}

describe("polling window", () => {
  it("reaches back the requested number of days from now", () => {
    expect(windowStart(30, NOW).toISOString()).toBe("2026-07-10T12:00:00.000Z");
    expect(windowStart(120, NOW).toISOString()).toBe("2026-04-11T12:00:00.000Z");
  });

  it("covers Cook's measured sale publication lag", () => {
    // The live feed on 2026-08-09 had a newest sale_date of 2026-05-28. If this
    // assertion ever fails, the window stopped covering the lag and the sales
    // source will quietly return nothing while still reporting healthy.
    const newestObservedSale = new Date("2026-05-28T00:00:00.000Z");
    expect(windowStart(cookSalesAdapter.lookbackDays, NOW).getTime()).toBeLessThan(
      newestObservedSale.getTime(),
    );
  });

  it("makes every adapter declare a usable lookback", () => {
    for (const adapter of allAdapters()) {
      expect(adapter.lookbackDays, `${adapter.id} lookbackDays`).toBeGreaterThan(0);
    }
  });
});

describe("future dated county records", () => {
  it("drops the typo years Cook publishes", () => {
    const events = [
      event("2026-08-01T00:00:00.000Z"),
      event("2032-12-06T00:00:00.000Z"),
      event("2089-07-09T23:09:07.000Z"),
      event("2210-04-21T23:34:33.000Z"),
    ];

    const { kept, dropped } = withoutFutureDates(events, NOW);
    expect(dropped).toBe(3);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.occurredAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("keeps events inside the tolerance so timezone skew is not data loss", () => {
    const justAhead = new Date(
      NOW.getTime() + (FUTURE_TOLERANCE_DAYS - 1) * 24 * 60 * 60 * 1000,
    );
    const { dropped } = withoutFutureDates([event(justAhead.toISOString())], NOW);
    expect(dropped).toBe(0);
  });

  it("keeps everything when nothing is future dated", () => {
    const { kept, dropped } = withoutFutureDates(
      [event("2026-01-01T00:00:00.000Z"), event("2025-06-30T00:00:00.000Z")],
      NOW,
    );
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(2);
  });

  it("handles an empty batch", () => {
    expect(withoutFutureDates([], NOW)).toEqual({ kept: [], dropped: 0 });
  });
});
