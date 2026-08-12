/**
 * Pulls web addresses out of whatever was pasted.
 *
 * Deliberately forgiving. A list copied from search results arrives with
 * titles, blank lines and stray punctuation around it, and asking someone to
 * clean that up by hand is the reason a tool goes unused.
 */
/**
 * Hosts that list businesses rather than being one.
 *
 * A search for contractors returns directories before it returns companies, and
 * scraping a directory finds either nothing or the directory's own sales
 * address. Both waste a slot in the batch and the second is worse, since it
 * would mean emailing Yelp about Buffalo lawn citations.
 */
const DIRECTORIES = [
  "yelp.", "thumbtack.", "angi.", "angieslist.", "homeadvisor.", "houzz.", "porch.",
  "bbb.org", "yellowpages.", "superpages.", "manta.", "mapquest.", "nextdoor.",
  "facebook.", "instagram.", "linkedin.", "twitter.", "x.com", "youtube.", "tiktok.",
  "indeed.", "glassdoor.", "chamberofcommerce.", "expertise.", "birdeye.",
  "homeguide.", "greenpal.", "yourgreenpal.", "realestatebees.", "listwithclever.",
  "propertyvendors.", "homeinvestorszone.", "apify.", "wikipedia.", "reddit.",
  "plowzandmowz.", "mylawnmowingservice.", "goloadup.", "lawnlove.", "taskrabbit.",
  "google.", "bing.", "duckduckgo.", "amazon.", "craigslist.",
];

/**
 * National franchises, which look like local businesses and are not.
 *
 * A SERVPRO or Junk King branch cannot buy a data subscription: corporate
 * decides what tools a franchisee uses, and the branch owner has no budget line
 * for it. They rank highly in every local search precisely because they buy the
 * ads, so without this they would crowd out the independents who can actually
 * say yes.
 */
const FRANCHISES = [
  "servpro", "puroclean", "pauldavis", "rainbowrestores", "911restoration",
  "servicemaster", "steamatic", "belfor", "chemdry", "stanleysteemer",
  "junk-king", "junkking", "jdogjunkremoval", "collegehunkshaulingjunk", "1800gotjunk",
  "junkluggers", "jiffyjunk", "twomenandajunktruck", "restoration1", "rytechinc",
  "modernistic", "water-damage.org",
  "spring-green", "springgreen", "lawnstarter", "trugreen", "weedman",
  "lawndoctor", "mosquitojoe", "terminix", "orkin", "rentokil", "aptive",
  "mrhandyman", "aireserv", "aire-serv", "mollymaid", "roto-rooter", "rotorooter",
];

function isFranchise(host: string): boolean {
  return FRANCHISES.some((name) => host.includes(name));
}

function isDirectory(host: string): boolean {
  return DIRECTORIES.some((needle) =>
    needle.endsWith(".") ? host.startsWith(needle) || host.includes(`.${needle}`) : host.includes(needle),
  );
}

export function parseUrls(input: string): string[] {
  const found = input.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];

  const bare = input
    .split(/[\s,]+/)
    .filter((token) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(token) && /\.[a-z]{2,}$/i.test(token))
    .map((token) => `https://${token}`);

  const cleaned = [...found, ...bare].map((url) => url.replace(/[.,;)]+$/, ""));

  // One entry per host. A search result page lists the same company three times
  // and scraping it three times only slows the run down.
  const byHost = new Map<string, string>();
  for (const url of cleaned) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      if (isDirectory(host) || isFranchise(host)) continue;
      if (!byHost.has(host)) byHost.set(host, url);
    } catch {
      // Not a real URL, so not a company.
    }
  }
  return [...byHost.values()];
}
