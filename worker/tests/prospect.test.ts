import { describe, expect, it } from "vitest";
import { buildMime, findDraftsFolder, hostForAddress } from "../src/prospect/mail-draft";
import { statsSentence, type MarketStats } from "../src/prospect/market-stats";
import { assemblePitch, type Prospect } from "../src/prospect/pitch";

const SENDER = {
  name: "Ben Shpritz",
  email: "ben@example.com",
  postalAddress: "1 Example St, Chicago IL 60601",
};

const BUFFALO: MarketStats = {
  fips: "36029",
  county: "Erie, NY",
  total: 4204,
  fresh: 311,
  withOwner: 0,
  kinds: ["CODE_VIOLATION"],
  newestAt: new Date("2026-07-28T00:00:00.000Z"),
};

const MILWAUKEE: MarketStats = {
  fips: "55079",
  county: "Milwaukee, WI",
  total: 18806,
  fresh: 87,
  withOwner: 18719,
  kinds: ["CODE_VIOLATION", "TAX_DELINQUENT"],
  newestAt: new Date("2026-08-04T00:00:00.000Z"),
};

const PROSPECT: Prospect = {
  id: "p1",
  company: "Queen City Home Buyers",
  website: "https://example.com",
  city: "Buffalo",
  personName: "Dana Whitfield",
  personRole: "Owner",
  email: "dana@example.com",
};

describe("what a market can prove", () => {
  it("states checkable numbers and no adjectives", () => {
    const sentence = statsSentence(BUFFALO);
    expect(sentence).toContain("4,204");
    expect(sentence).toContain("Erie, NY");
    expect(sentence).toContain("open code enforcement cases");
    // The entire pitch rests on a prospect being able to verify this against
    // their own county. Marketing language is what makes them stop checking.
    expect(sentence).not.toMatch(/exciting|incredible|game changing|unlock|massive/i);
  });

  it("leads with owner contact only where the county actually publishes it", () => {
    expect(statsSentence(MILWAUKEE)).toContain("owner's name and mailing address");
    expect(statsSentence(BUFFALO)).not.toContain("mailing address");
  });

  it("says nothing rather than something empty for a market with no data", () => {
    expect(statsSentence({ ...BUFFALO, total: 0 })).toBe("Nothing on file for Erie, NY yet.");
  });
});

describe("the assembled pitch", () => {
  const body = assemblePitch(PROSPECT, BUFFALO, { subject: "Buffalo code cases", hook: "Saw you buy in the Broadway Fillmore area." }, SENDER);

  it("carries a working opt out and a postal address", () => {
    // Both are required of commercial email in the United States, and the opt
    // out is honoured permanently by suppress().
    expect(body).toContain("reply no and I will not email you again");
    expect(body).toContain(SENDER.postalAddress);
  });

  it("uses the numbers from the market rather than any the model produced", () => {
    expect(body).toContain("4,204");
  });

  it("greets the person by first name only", () => {
    expect(body.startsWith("Hi Dana,")).toBe(true);
  });

  it("still writes a sound email when nobody is named", () => {
    const anonymous = assemblePitch(
      { ...PROSPECT, personName: null },
      BUFFALO,
      { subject: "s", hook: "h" },
      SENDER,
    );
    expect(anonymous.startsWith("Hi,")).toBe(true);
  });

  it("contains no em dashes, which is the house rule", () => {
    expect(body).not.toMatch(/[—–]/);
  });
});

describe("draft encoding", () => {
  const date = new Date("2026-08-12T09:00:00.000Z");

  it("strips newlines out of header values", () => {
    // Prospect names come from scraped pages, so they are exactly the untrusted
    // input that would carry a header injection.
    const mime = buildMime(
      {
        to: "dana@example.com",
        subject: "Hello\r\nBcc: victim@example.com",
        body: "Body text",
        fromName: "Ben\nX-Evil: yes",
        fromEmail: "ben@example.com",
      },
      date,
    );

    // The injected text survives as part of a header's value, which is
    // harmless. What must not survive is a new header line, so this asserts on
    // how lines start rather than on the text appearing anywhere.
    const headerLines = (mime.split("\r\n\r\n")[0] ?? "").split("\r\n");
    expect(headerLines.some((line) => /^Bcc:/i.test(line))).toBe(false);
    expect(headerLines.some((line) => /^X-Evil:/i.test(line))).toBe(false);
    expect(headerLines).toContain("Subject: Hello Bcc: victim@example.com");
  });

  it("separates headers from the body with a blank line", () => {
    const mime = buildMime(
      {
        to: "a@b.com",
        subject: "s",
        body: "line one\nline two",
        fromName: "N",
        fromEmail: "n@b.com",
      },
      date,
    );
    expect(mime).toContain("\r\n\r\nline one\nline two");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
  });
});

describe("which mailbox to connect to", () => {
  it("works out the host from the address for the common providers", () => {
    expect(hostForAddress("ben@icloud.com")?.host).toBe("imap.mail.me.com");
    expect(hostForAddress("ben@me.com")?.host).toBe("imap.mail.me.com");
    expect(hostForAddress("ben@gmail.com")?.host).toBe("imap.gmail.com");
    expect(hostForAddress("ben@outlook.com")?.host).toBe("outlook.office365.com");
  });

  it("cannot guess a custom domain, which is why the override exists", () => {
    // hello@lentamente.us is an iCloud+ custom domain and still connects to
    // Apple, so no amount of reading the address would get this right.
    expect(hostForAddress("hello@lentamente.us")).toBeNull();
  });
});

describe("finding the drafts folder", () => {
  const listing = (boxes: Array<{ path: string; specialUse?: string }>) =>
    ({ list: async () => boxes }) as never;

  it("prefers the special use flag over the folder name", async () => {
    // Gmail calls it [Gmail]/Drafts and iCloud calls it Drafts. The flag is the
    // same on both, which is why it is read first.
    await expect(
      findDraftsFolder(listing([{ path: "INBOX" }, { path: "Entwürfe", specialUse: "\\Drafts" }])),
    ).resolves.toBe("Entwürfe");
  });

  it("falls back to known names when the server flags nothing", async () => {
    await expect(
      findDraftsFolder(listing([{ path: "INBOX" }, { path: "[Gmail]/Drafts" }])),
    ).resolves.toBe("[Gmail]/Drafts");
    await expect(
      findDraftsFolder(listing([{ path: "INBOX" }, { path: "Drafts" }])),
    ).resolves.toBe("Drafts");
  });

  it("says so rather than appending a draft somewhere wrong", async () => {
    await expect(findDraftsFolder(listing([{ path: "INBOX" }]))).rejects.toThrow(/No drafts folder/);
  });
});
