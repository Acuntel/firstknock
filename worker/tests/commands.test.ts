import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseConnectCode, parsePause } from "../src/telegram/commands";
import { generateConnectCode } from "../src/telegram/connect";

const NOW = new Date("2026-08-09T12:00:00.000Z");

describe("/pause", () => {
  it("reads days, hours, and weeks", () => {
    expect(parsePause("7d", NOW).until?.toISOString()).toBe("2026-08-16T12:00:00.000Z");
    expect(parsePause("12h", NOW).until?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(parsePause("2w", NOW).until?.toISOString()).toBe("2026-08-23T12:00:00.000Z");
  });

  it("reads a bare number as days", () => {
    // Someone typing "/pause 7" means a week off, not seven hours.
    expect(parsePause("7", NOW).until?.toISOString()).toBe("2026-08-16T12:00:00.000Z");
  });

  it("tolerates spacing and case", () => {
    expect(parsePause(" 7 D ", NOW).ok).toBe(true);
  });

  it("asks again rather than guessing", () => {
    expect(parsePause("", NOW).ok).toBe(false);
    expect(parsePause(undefined, NOW).ok).toBe(false);
    expect(parsePause("next tuesday", NOW).ok).toBe(false);
    expect(parsePause("0d", NOW).ok).toBe(false);
  });

  it("refuses a pause long enough to look like an outage", () => {
    const result = parsePause("52w", NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("90 days");
  });

  it("replies in a full sentence, since the user reads it", () => {
    const result = parsePause("7d", NOW);
    expect(result.message).toContain("2026-08-16");
    expect(result.message.endsWith(".")).toBe(true);
  });
});

describe("connect codes", () => {
  it("accepts a plausible payload", () => {
    expect(parseConnectCode("k7m2p9qr4x")).toBe("k7m2p9qr4x");
  });

  it("rejects noise rather than querying on it", () => {
    expect(parseConnectCode("")).toBeNull();
    expect(parseConnectCode(undefined)).toBeNull();
    expect(parseConnectCode("short")).toBeNull();
    expect(parseConnectCode("has spaces here")).toBeNull();
    expect(parseConnectCode("'; drop table tenants; --")).toBeNull();
  });

  it("generates codes without look alike characters", () => {
    // These get read off a screen and retyped into a group chat, where an l
    // against a 1 costs a support message.
    for (let i = 0; i < 50; i += 1) {
      expect(generateConnectCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/);
    }
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateConnectCode()));
    expect(codes.size).toBe(200);
  });

  it("generates codes its own parser accepts", () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generateConnectCode();
      expect(parseConnectCode(code)).toBe(code);
    }
  });
});

describe("help text", () => {
  it("lists every command the bot implements", () => {
    for (const command of ["/leads", "/pause", "/resume", "/help", "/connect"]) {
      expect(HELP_TEXT).toContain(command);
    }
  });
});
