import { describe, expect, it } from "vitest";
import { buildMime, findDraftsFolder, hostForAddress } from "../src/prospect/mail-draft";
import { citationLabel, statsSentence, type MarketStats } from "../src/prospect/market-stats";
import { assembleLeadPitch, assemblePitch, streetOnly, withoutDuplicateGreeting, wrap, type Prospect } from "../src/prospect/pitch";
import { nameFromMailbox, nameMatchesMailbox } from "../src/prospect/store";
import { extractEmails, scrapeCompanyName } from "../src/prospect/scraper";

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

describe("plain text wrapping", () => {
  it("wraps every paragraph, generated ones included", () => {
    const body = assemblePitch(
      PROSPECT,
      MILWAUKEE,
      { subject: "s", hook: "A ".repeat(80).trim() },
      SENDER,
    );
    // The first version wrapped only the fixed template, so a long generated
    // sentence sat unbroken beside neatly wrapped ones.
    for (const line of body.split("\n")) {
      expect(line.length, line).toBeLessThanOrEqual(72);
    }
  });

  it("never splits a word", () => {
    const word = "x".repeat(90);
    expect(wrap(`start ${word} end`).split("\n")).toContain(word);
  });

  it("keeps deliberate line breaks, like the signature", () => {
    expect(wrap("Ben Shpritz\nben@example.com")).toBe("Ben Shpritz\nben@example.com");
  });
});

describe("who a scraped address may be greeted as", () => {
  it("never greets a role mailbox by a researched name", () => {
    // info@ belongs to whoever picks it up, so "Hi Dana" there is a guess the
    // reader can see through immediately.
    expect(nameMatchesMailbox("Dana Whitfield", "info@example.com")).toBe(false);
    expect(nameMatchesMailbox("Dana Whitfield", "sales@example.com")).toBe(false);
    expect(nameMatchesMailbox("Dana Whitfield", "contact@example.com")).toBe(false);
  });

  it("allows a personal mailbox that actually contains the name", () => {
    expect(nameMatchesMailbox("Dana Whitfield", "dana@example.com")).toBe(true);
    expect(nameMatchesMailbox("Dana Whitfield", "whitfield@example.com")).toBe(true);
    expect(nameMatchesMailbox("Dana Whitfield", "dana.whitfield@example.com")).toBe(true);
  });

  it("refuses a personal mailbox belonging to somebody else", () => {
    // jsmith@ greeted "Hi Dana" is the exact failure the rule exists to stop.
    expect(nameMatchesMailbox("Dana Whitfield", "jsmith@example.com")).toBe(false);
  });
});

describe("reading a company name off a page", () => {
  const title = (t: string) => `<html><head><title>${t}</title></head><body></body></html>`;

  it("decodes entities rather than shipping them to a prospect", () => {
    expect(scrapeCompanyName(title("Grabber &amp; Sons"))).toBe("Grabber & Sons");
  });

  it("rejects a page name that is not a business name", () => {
    // An email addressed to a company called Home is worse than one addressed
    // to nobody, and the importer falls back to the domain.
    expect(scrapeCompanyName(title("Home"))).toBeNull();
    expect(scrapeCompanyName(title("Welcome"))).toBeNull();
  });

  it("rejects a tagline masquerading as a name", () => {
    expect(
      scrapeCompanyName(title("The best landscaping and snow removal in all of Western New York")),
    ).toBeNull();
  });

  it("keeps the name and drops the tagline after it", () => {
    expect(scrapeCompanyName(title("716 Lawn Care | Best Landscaping in Buffalo"))).toBe("716 Lawn Care");
  });
});

describe("quoting a citation back to a contractor", () => {
  const label = (violation: string) => citationLabel({ violation });

  it("keeps only the part that says what is wrong", () => {
    expect(label("SPCC - Section 27-72 (f) - Overgrowth")).toBe("Overgrowth");
    expect(label("2025 PMCNYS - Section 305.3 - Interior Surfaces")).toBe("Interior Surfaces");
    expect(label("SPCC - Section 27-72 (e) -Trash & Debris")).toBe("Trash & Debris");
  });

  it("never eats the front of a real word", () => {
    // An earlier version stripped any leading few characters and produced
    // "mulation of Rubbish" and "growth", which is worse than quoting nothing.
    expect(label("2025 PMCNYS - Section 308.1 - Accumulation of Rubbish")).toBe(
      "Accumulation of Rubbish",
    );
    expect(label("Rubbish Storage Facilities")).toBe("Rubbish Storage Facilities");
  });

  it("rejects a label that describes nothing", () => {
    // Buffalo files most cases as GENERAL, and "cited as GENERAL" is worse than
    // quoting nothing at all.
    expect(label("GENERAL")).toBe("");
    expect(label("RR-GENERAL")).toBe("");
    expect(label("-GENERAL")).toBe("");
  });

  it("falls through to the next field when the first is useless", () => {
    expect(citationLabel({ violation: "GENERAL", complaint_type_name: "Tall Grass and Weeds" })).toBe(
      "Tall Grass and Weeds",
    );
  });
});

describe("reading a first name off the mailbox", () => {
  it("uses a mailbox that plainly is a first name", () => {
    // mike@ is not a guess about who works there, it is what they published.
    expect(nameFromMailbox("mike@greengeniewny.com")).toBe("Mike");
    expect(nameFromMailbox("Sarah@example.com")).toBe("Sarah");
  });

  it("refuses anything that is not a name", () => {
    // Without the whitelist the same logic produces "Hi Greengenie" and
    // "Hi Jdlandscaping93", which is worse than not greeting anyone.
    expect(nameFromMailbox("greengenie@example.com")).toBeNull();
    expect(nameFromMailbox("jdlandscaping93@example.com")).toBeNull();
    expect(nameFromMailbox("info@example.com")).toBeNull();
    expect(nameFromMailbox("sales@example.com")).toBeNull();
    expect(nameFromMailbox("mm@example.com")).toBeNull();
    expect(nameFromMailbox(null)).toBeNull();
  });
});

describe("addresses pulled out of a page", () => {
  it("strips percent encoding off a mailto link", () => {
    // "mailto:%20name@host" leaves the %20 attached, and %20syracuselawn@gmail
    // was written to the database before this.
    const html = '<a href="mailto:%20hello@example.com">Email us</a>';
    expect(extractEmails(html, "example.com")[0]?.email).toBe("hello@example.com");
  });

  it("prefers an address on the company's own domain", () => {
    const html = "someone@gmail.com and office@example.com";
    const found = extractEmails(html, "example.com");
    expect(found[0]?.email).toBe("office@example.com");
    expect(found[0]?.onDomain).toBe(true);
  });

  it("ignores addresses belonging to neither them nor a free provider", () => {
    // Their web designer, a directory, or a partner. Not a person who works there.
    expect(extractEmails("hi@somewebagency.io", "example.com")).toHaveLength(0);
  });
});

describe("what the lead email gives away", () => {
  const sample = {
    address: "418 Merriman Ave",
    city: "SYRACUSE",
    citation: "Accumulation of Rubbish or Garbage",
    occurredAt: new Date("2026-08-10T00:00:00.000Z"),
    hasOwner: true,
  };
  const now = new Date("2026-08-12T00:00:00.000Z");
  const body = assembleLeadPitch(
    PROSPECT,
    sample,
    { ...MILWAUKEE, county: "Onondaga, NY", segmentCount: 87, segmentLabel: "Junk removal and hauling", examples: [] },
    { subject: "s", hook: "h" },
    { ...SENDER, phone: "555 0100" },
    now,
  );

  it("names the street but never the house number", () => {
    // Proof, not inventory. A street name says the record is real; the number
    // is the thing they are being asked to pay for.
    expect(body).toContain("Merriman Ave");
    expect(body).not.toContain("418");
  });

  it("strips the number off any shape of address", () => {
    expect(streetOnly("418 Merriman Ave")).toBe("Merriman Ave");
    expect(streetOnly("6516/6518 N 107TH ST")).toBe("N 107TH ST");
    expect(streetOnly("77 POPLAR")).toBe("POPLAR");
    // Nothing to strip, so it is left alone rather than emptied.
    expect(streetOnly("BROADWAY")).toBe("BROADWAY");
  });

  it("offers a conversation about price, not free leads", () => {
    expect(body).not.toMatch(/no cost|free|at no charge/i);
    // Two things at once: the closing line varies per company so two hundred
    // sends are not two hundred copies, and the body is wrapped at 72 columns,
    // so a phrase can be split across a line break. Assert the intent, on text
    // with the wrapping collapsed.
    const flat = body.replace(/\s+/g, " ");
    expect(flat).toMatch(/worth to you|fair price|pricing that makes sense|worth to have it first/);
  });

  it("asks for a call when a number is set", () => {
    expect(body).toContain("call me on 555 0100");
  });

  it("asks for a reply when no number is set", () => {
    const noPhone = assembleLeadPitch(
      PROSPECT,
      sample,
      { ...MILWAUKEE, segmentCount: 5, segmentLabel: "Junk removal and hauling", examples: [] },
      { subject: "s", hook: "h" },
      SENDER,
      now,
    );
    expect(noPhone).toMatch(/set up a short call/);
    expect(noPhone).not.toContain("call me on");
  });
});

describe("greeting the same person twice", () => {
  it("drops a name the model repeated on top of the template's", () => {
    // The template writes "Hi Mike," and the model sometimes opens "Mike, Erie
    // just posted", which lands as "Hi Mike, Mike, Erie just posted".
    expect(withoutDuplicateGreeting("Mike, Erie just posted citations.", "Mike Bowers")).toBe(
      "Erie just posted citations.",
    );
    expect(withoutDuplicateGreeting("Hi Mike, Erie just posted.", "Mike Bowers")).toBe(
      "Erie just posted.",
    );
  });

  it("leaves an opening that does not repeat the name", () => {
    expect(withoutDuplicateGreeting("Erie just posted citations.", "Mike Bowers")).toBe(
      "Erie just posted citations.",
    );
  });

  it("never empties the hook", () => {
    expect(withoutDuplicateGreeting("Mike,", "Mike Bowers")).toBe("Mike,");
  });

  it("does nothing when nobody is named", () => {
    expect(withoutDuplicateGreeting("Mike, hello.", null)).toBe("Mike, hello.");
  });
});

describe("two hundred emails that are not the same email", () => {
  const stats = { ...MILWAUKEE, segmentLabel: "Lawn care", segmentCount: 134, examples: [] };
  const body = (email: string) =>
    assembleLeadPitch(
      { ...PROSPECT, email, personName: null },
      {
        address: "77 POPLAR",
        city: "BUFFALO",
        citation: "Weeds",
        occurredAt: new Date("2026-08-01"),
        hasOwner: true,
      },
      stats,
      { subject: "s", hook: "H." },
      SENDER,
      new Date("2026-08-13"),
    );

  it("gives the same company the same wording every time", () => {
    // A random pick would rewrite the email on every regeneration, and someone
    // who saw two versions would rightly wonder what else was generated.
    expect(body("a@x.com")).toBe(body("a@x.com"));
  });

  it("gives different companies different wording", () => {
    const many = ["a@x.com", "b@y.com", "c@z.com", "d@w.com", "e@v.com", "f@u.com"].map(body);
    // The template used to be the same bytes in every email, which is the
    // bulk pattern filters look for regardless of how well the opening reads.
    expect(new Set(many).size).toBeGreaterThan(1);
  });

  it("keeps every variant saying the same thing", () => {
    for (const email of ["a@x.com", "b@y.com", "c@z.com", "d@w.com"]) {
      const text = body(email);
      expect(text).toContain("POPLAR");
      expect(text).toMatch(/134|133/);
      expect(text).toContain("reply no and I will not email you again");
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/no cost|\bfree\b/i);
    }
  });
});

describe("keeping ordinance codes out of the writing", () => {
  it("keeps only the part of a citation that describes something", () => {
    // The county writes the ordinance and the description together in several
    // different punctuations, and only the description means anything.
    expect(citationLabel({ violation: "SPCC-Sec. 27-133 Registration" })).toBe("Registration");
    expect(citationLabel({ violation: "SPCC 27-43 (e) (1)(2)(3)(4) Certification" })).toBe(
      "Certification",
    );
    expect(citationLabel({ violation: "2025 PMCNYS - Section 309.1 - Infestation" })).toBe(
      "Infestation",
    );
  });

  it("does not mistake a hyphenated word for an ordinance separator", () => {
    // Splitting on any dash turned this into "family dwelling", which throws
    // away the only words a landscaper would have recognised.
    expect(citationLabel({ violation: "Excessive weeds or plant growth one- or two-family dwelling" })).toContain(
      "Excessive weeds",
    );
  });

  it("leaves a plain description alone", () => {
    expect(citationLabel({ violation: "Interior Surfaces" })).toBe("Interior Surfaces");
    expect(citationLabel({ violation: "Window, Skylight and Door Frame" })).toBe(
      "Window, Skylight and Door Frame",
    );
  });
});
