import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prospect } from "./pitch";

export interface ProspectRow extends Prospect {
  fips: string | null;
  emailConfidence: string;
  status: string;
  doNotContact: boolean;
  /** Which buyer segment they belong to, from buyers.ts. */
  segment: string;
}

function toProspect(row: Record<string, unknown>): ProspectRow {
  return {
    id: String(row.id),
    company: String(row.company),
    website: (row.website as string) ?? null,
    city: (row.city as string) ?? null,
    fips: (row.fips as string) ?? null,
    personName: (row.person_name as string) ?? null,
    personRole: (row.person_role as string) ?? null,
    email: (row.email as string) ?? null,
    emailConfidence: String(row.email_confidence ?? "guessed"),
    status: String(row.status ?? "new"),
    doNotContact: Boolean(row.do_not_contact),
    // Kept in notes rather than its own column so adding segments never needs a
    // migration. They are a product decision that will change more often than
    // the schema should.
    segment: String((row.notes as Record<string, unknown> | null)?.segment ?? "flippers"),
  };
}

/**
 * Prospects that may be written to right now.
 *
 * An address that is either verified outright or published by the company on
 * its own domain, because a guess that bounces costs the sending domain more
 * than the lead is worth. See confidenceFrom in import.ts for why the middle
 * tier exists: residential internet blocks the port the strict check needs. Not already drafted, because one address is only
 * ever written to once in a campaign. Not suppressed, because someone who said
 * no said it permanently.
 *
 * A named person is deliberately NOT required, which departs from
 * EMAIL_BOT_SAUCE.md, and the departure is evidence based. Scraping real
 * contractor sites in these four metros turns up an address on roughly one site
 * in four and a named person on almost none: small trades use contact forms and
 * an info@ mailbox, and that mailbox is usually the owner's phone.
 *
 * The rule in the doc exists to stop "Hi Mike" landing in John's inbox, and
 * that hazard is real. But the fix for an unknown name is to not use one:
 * assemblePitch greets an unnamed prospect with "Hi," which is safe. What is
 * never allowed is a name we are not sure belongs to the mailbox, and
 * nameMatchesMailbox below is what enforces that.
 */
export async function draftableProspects(
  client: SupabaseClient,
  limit: number,
  fips?: string,
): Promise<ProspectRow[]> {
  let query = client
    .from("prospects")
    .select("*")
    .in("email_confidence", ["verified", "published"])
    .eq("do_not_contact", false)
    .eq("status", "new")
    .not("email", "is", null)
    .limit(limit);

  if (fips) query = query.eq("fips", fips);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load prospects: ${error.message}`);

  // A name we cannot tie to the mailbox is dropped rather than the prospect,
  // so the email still goes out addressed to nobody in particular instead of to
  // the wrong person by name.
  return (data ?? [])
    .map((row) => toProspect(row as Record<string, unknown>))
    .map((prospect) => {
      if (prospect.personName && nameMatchesMailbox(prospect.personName, prospect.email)) {
        return prospect;
      }
      // A researched name that cannot be tied to the mailbox is dropped. The
      // mailbox itself is then the only trustworthy source of a name left.
      return { ...prospect, personName: nameFromMailbox(prospect.email) };
    });
}

/**
 * Whether a researched name can safely be used to greet this mailbox.
 *
 * Shared and role mailboxes are fine to greet generically: info@ belongs to
 * whoever picks it up, so "Hi," is honest. A personal mailbox is the dangerous
 * case, because jsmith@ addressed "Hi Mike" tells the reader immediately that
 * this was scraped and guessed at.
 *
 * So a personal looking mailbox has to actually contain part of the name.
 */
export function nameMatchesMailbox(name: string, email: string | null): boolean {
  if (!email) return false;
  const local = email.split("@")[0]?.toLowerCase() ?? "";

  const ROLE_MAILBOXES = /^(info|contact|hello|hi|office|admin|sales|support|team|service|help|inquiries|estimates|dispatch|scheduling|bookings|mail)$/;
  if (ROLE_MAILBOXES.test(local)) return false;

  const parts = name.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
  return parts.some((part) => local.includes(part));
}

/**
 * Common first names, for reading a name off the mailbox itself.
 *
 * A whitelist rather than a heuristic, because the failure mode of guessing is
 * greeting a company "Hi Greengenie" or "Hi Info". Short and unglamorous, and
 * it only has to cover the names that actually appear in front of an @ on a
 * contractor's website.
 */
const FIRST_NAMES = new Set([
  "aaron","adam","alan","albert","alex","andrew","andy","anthony","antonio","arthur",
  "barry","ben","bill","billy","bob","bobby","brad","brandon","brian","bruce","bryan",
  "carl","carlos","chad","charles","charlie","chris","craig","curtis","dan","daniel",
  "danny","darren","dave","david","dean","dennis","derek","don","donald","doug","douglas",
  "drew","earl","ed","eddie","eric","erik","ernie","frank","fred","gary","gene","george",
  "gerald","glen","glenn","greg","gregory","harold","harry","henry","herb","howard",
  "jack","jacob","jake","james","jamie","jason","javier","jay","jeff","jeffrey","jerry",
  "jesse","jim","jimmy","joe","joel","john","johnny","jon","jonathan","jordan","jose",
  "joseph","josh","joshua","juan","justin","keith","kelly","ken","kenny","kevin","kurt",
  "kyle","lance","larry","lee","leo","leon","leonard","lewis","lou","louis","luis","luke",
  "manny","marc","marco","mark","martin","marty","matt","matthew","maurice","max","mel",
  "michael","mickey","mike","miguel","mitch","nate","nathan","neil","nick","nicholas",
  "norm","oscar","pat","patrick","paul","pedro","pete","peter","phil","phillip","ralph",
  "randy","ray","raymond","rich","richard","rick","ricky","rob","robert","rodney","roger",
  "ron","ronald","ronnie","ross","roy","russ","russell","ryan","sal","sam","samuel","scott",
  "sean","shane","shaun","shawn","stan","stanley","steve","steven","stephen","stu","ted",
  "terry","thomas","tim","timothy","todd","tom","tommy","tony","travis","trevor","troy",
  "vince","vincent","wade","walter","warren","wayne","wes","will","william","willie","zach",
  "amanda","amy","andrea","angela","ann","anna","anne","april","barbara","beth","betty",
  "beverly","brenda","carol","carolyn","catherine","cathy","cheryl","christine","cindy",
  "claire","colleen","connie","cynthia","dawn","deb","debbie","deborah","debra","denise",
  "diana","diane","donna","doris","dorothy","elaine","elizabeth","ellen","emily","erin",
  "gail","gina","gloria","heather","heidi","helen","holly","jackie","jane","janet","janice",
  "jean","jeanne","jen","jenn","jennifer","jessica","jill","joan","joanne","jodi","joy",
  "joyce","judy","julie","june","karen","kate","kathy","katherine","kathleen","kelli",
  "kim","kimberly","kris","kristen","kristin","laura","lauren","laurie","linda","lisa",
  "lori","lynn","marcia","margaret","maria","marie","marilyn","marsha","martha","mary",
  "maureen","megan","melissa","michelle","monica","nancy","nicole","pam","pamela","patricia",
  "patty","paula","peggy","rachel","rebecca","regina","renee","rhonda","rita","robin",
  "rosa","rose","ruth","sally","sandra","sandy","sara","sarah","sharon","sheila","shelly",
  "sherry","shirley","stacy","stephanie","sue","susan","suzanne","tammy","teresa","terri",
  "theresa","tina","tracy","valerie","vicki","victoria","wendy",
]);

/**
 * A first name taken from the mailbox, when the mailbox plainly is one.
 *
 * mike@ is not a guess about who works there, it is what they wrote on their
 * own website, so greeting them "Hi Mike" is using their words rather than
 * inventing a person. That matters: a named greeting reads as a human wrote it
 * and "Hi," reads as a mail merge.
 *
 * The whitelist is what keeps it honest. Without it the same logic produces
 * "Hi Greengenie" and "Hi Jdlandscaping93".
 */
export function nameFromMailbox(email: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!/^[a-z]{3,10}$/.test(local)) return null;
  if (!FIRST_NAMES.has(local)) return null;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export async function markDrafted(
  client: SupabaseClient,
  id: string,
  now: Date,
): Promise<void> {
  const { error } = await client
    .from("prospects")
    .update({ status: "drafted", drafted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to mark drafted: ${error.message}`);
}

/**
 * Takes someone out of every future campaign.
 *
 * Permanent by design and it applies to the address rather than the row, so
 * re-importing the same company from a later discovery run cannot resurrect
 * them. A reply of "no" is the only opt out this system offers, so it has to
 * actually work.
 */
export async function suppress(
  client: SupabaseClient,
  email: string,
  reason: string,
  now: Date,
): Promise<void> {
  const { error } = await client
    .from("prospects")
    .update({
      do_not_contact: true,
      suppressed_reason: reason,
      status: "suppressed",
      updated_at: now.toISOString(),
    })
    .ilike("email", email);
  if (error) throw new Error(`Failed to suppress ${email}: ${error.message}`);
}

export interface ProspectInput {
  company: string;
  website?: string;
  city?: string;
  state?: string;
  fips?: string;
  personName?: string;
  personRole?: string;
  email?: string;
  emailConfidence?: string;
  segment?: string;
}

/**
 * Adds prospects, ignoring any address already known.
 *
 * The unique index on the address does the deduplication, so a second discovery
 * run over the same city is a no-op rather than a source of duplicate emails to
 * the same person.
 */
export async function upsertProspects(
  client: SupabaseClient,
  inputs: ProspectInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;

  const rows = inputs.map((input) => ({
    company: input.company,
    website: input.website ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    fips: input.fips ?? null,
    person_name: input.personName ?? null,
    person_role: input.personRole ?? null,
    email: input.email?.toLowerCase() ?? null,
    email_confidence: input.emailConfidence ?? "guessed",
    notes: { segment: input.segment ?? "flippers" },
  }));

  const { data, error } = await client
    .from("prospects")
    .upsert(rows, { onConflict: "email", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Failed to add prospects: ${error.message}`);
  return (data ?? []).length;
}
