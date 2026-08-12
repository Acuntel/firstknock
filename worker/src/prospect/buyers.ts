import type { EventType } from "../types";

export interface BuyerSegment {
  id: string;
  /** How this kind of business describes itself, for discovery searches. */
  searchTerms: string[];
  label: string;
  /** Why this data is worth money to them, in one line, for the pitch. */
  why: string;
  eventTypes: EventType[];
  /**
   * Words that appear in the citation itself when the job is theirs.
   *
   * Matched against the violation text, so a landscaper is offered the
   * overgrowth citations rather than every violation in the county.
   */
  citationKeywords?: string[];
  /** Rough monthly price to open the conversation at. */
  monthlyPrice: number;
}

/**
 * Who actually buys this, and what they buy.
 *
 * Written after reading what the counties are really citing rather than from a
 * guess about the market, and the data changed the answer. Syracuse's top
 * violations are overgrowth, trash and debris, interior surfaces and
 * infestation. Buffalo's third most common is literally GRASS. Those are not
 * abstract distress signals, they are work orders: a named owner has been told
 * by the city to fix a specific thing by a specific date, and there is a trade
 * that does exactly that thing.
 *
 * That makes the trades a better first customer than flippers in one important
 * way. A flipper wants a motivated seller, which is a maybe. A landscaper
 * looking at 91 overgrowth citations is looking at 91 people under a legal
 * obligation to hire a landscaper this month, with the owner's mailing address
 * attached. The buying case does not need explaining.
 *
 * Flippers and lenders are still here, because they pay more per seat. They are
 * just a harder first sale.
 */
export const BUYER_SEGMENTS: BuyerSegment[] = [
  {
    id: "landscaping",
    label: "Lawn care and landscaping",
    searchTerms: ["lawn care service", "landscaping company", "property maintenance"],
    why: "Every overgrowth citation is a homeowner legally required to cut their grass, with a deadline.",
    eventTypes: ["CODE_VIOLATION"],
    citationKeywords: ["overgrowth", "grass", "weed", "lawn", "vegetation"],
    monthlyPrice: 149,
  },
  {
    id: "junk-removal",
    label: "Junk removal and hauling",
    searchTerms: ["junk removal", "hauling service", "property cleanout"],
    why: "A trash and debris citation is a cleanout job the owner has been ordered to book.",
    eventTypes: ["CODE_VIOLATION"],
    citationKeywords: ["trash", "debris", "rubbish", "refuse", "garbage", "accumulation"],
    monthlyPrice: 149,
  },
  {
    id: "pest-control",
    label: "Pest control",
    searchTerms: ["pest control company", "exterminator"],
    why: "An infestation citation is a signed confession that the property needs an exterminator.",
    eventTypes: ["CODE_VIOLATION"],
    citationKeywords: ["infestation", "rodent", "vermin", "pest", "insect"],
    monthlyPrice: 199,
  },
  {
    id: "restoration",
    label: "Restoration and remediation",
    searchTerms: ["fire and water restoration", "water damage restoration", "mold remediation"],
    why: "Interior surface and structural citations are the damage they repair, before the owner starts calling around.",
    eventTypes: ["CODE_VIOLATION", "FIRE_INCIDENT"],
    citationKeywords: ["interior surfaces", "structural", "water", "mold", "ceiling", "wall", "roof"],
    monthlyPrice: 299,
  },
  {
    id: "roofing",
    label: "Roofing and exteriors",
    searchTerms: ["roofing contractor", "roofing company", "siding contractor"],
    why: "Roof and exterior citations, plus permits next door, which is where the neighbourhood work comes from.",
    eventTypes: ["CODE_VIOLATION", "PERMIT"],
    citationKeywords: ["roof", "gutter", "siding", "exterior", "chimney"],
    monthlyPrice: 249,
  },
  {
    id: "windows-doors",
    label: "Windows and doors",
    searchTerms: ["window replacement company", "door installation contractor"],
    why: "Window, skylight and door frame citations name the exact product they sell.",
    eventTypes: ["CODE_VIOLATION"],
    citationKeywords: ["window", "skylight", "door frame", "door"],
    monthlyPrice: 199,
  },
  {
    id: "property-preservation",
    label: "Property preservation and board up",
    searchTerms: ["property preservation company", "board up service", "vacant property services"],
    why: "Vacant building registrations are the entire job description, and somebody has to secure them.",
    eventTypes: ["CODE_VIOLATION"],
    citationKeywords: ["vacant", "board", "secure", "abandoned", "open and accessible"],
    monthlyPrice: 249,
  },
  {
    id: "flippers",
    label: "House flippers and wholesalers",
    searchTerms: ["we buy houses", "cash home buyer", "real estate wholesaler", "house flipping company"],
    why: "Tax delinquency and vacancy are the two signals that a seller is motivated before the listing exists.",
    eventTypes: ["TAX_DELINQUENT", "CODE_VIOLATION", "SALE"],
    monthlyPrice: 399,
  },
  {
    id: "hard-money",
    label: "Hard money and private lenders",
    searchTerms: ["hard money lender", "private real estate lender", "fix and flip loans"],
    why: "They fund the flippers, so the same list tells them who is about to need a loan.",
    eventTypes: ["TAX_DELINQUENT", "SALE", "PERMIT"],
    monthlyPrice: 499,
  },
  {
    id: "property-management",
    label: "Property management",
    searchTerms: ["property management company", "rental property management"],
    why: "Rental registry and landlord citations are owners with a compliance problem and no manager.",
    eventTypes: ["CODE_VIOLATION"],
    citationKeywords: ["rental", "registration", "certification", "rr-", "landlord"],
    monthlyPrice: 299,
  },
];

export function segment(id: string): BuyerSegment {
  const found = BUYER_SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`No buyer segment named "${id}"`);
  return found;
}

/**
 * Whether a citation is this segment's kind of work.
 *
 * A segment with no keywords wants every event of its types, which is right for
 * a flipper: they are buying the whole distressed list, not one trade's slice.
 */
export function matchesSegment(segment: BuyerSegment, citation: string | undefined): boolean {
  if (!segment.citationKeywords) return true;
  if (!citation) return false;

  const text = citation.toLowerCase();
  return segment.citationKeywords.some((word) => text.includes(word));
}

export interface Market {
  fips: string;
  /** The city the feed actually covers, which is rarely the whole county. */
  city: string;
  state: string;
  label: string;
}

/**
 * The markets there is data to sell.
 *
 * The city rather than the county on purpose. Every one of these feeds is
 * published by a city, so Skaneateles is not in the Syracuse data and
 * Cheektowaga is not in the Buffalo data, and importing a suburban contractor
 * against a city feed would promise them coverage that does not exist.
 */
export const MARKETS: Market[] = [
  { fips: "55079", city: "Milwaukee", state: "WI", label: "Milwaukee, WI" },
  { fips: "36029", city: "Buffalo", state: "NY", label: "Buffalo, NY" },
  { fips: "36067", city: "Syracuse", state: "NY", label: "Syracuse, NY" },
  { fips: "26163", city: "Detroit", state: "MI", label: "Detroit, MI" },
];

export function market(fips: string): Market {
  const found = MARKETS.find((m) => m.fips === fips);
  if (!found) throw new Error(`No market with FIPS ${fips}`);
  return found;
}
