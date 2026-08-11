interface County {
  name: string;
  state: string;
}

/**
 * The county FIPS codes V1 covers, from ben/DESIGN_PARTNERS.md. Lives in the
 * worker so digest copy and the web app cannot drift into calling the same
 * county two different things.
 */
const COUNTIES: Record<string, County> = {
  "17031": { name: "Cook", state: "IL" },
  "17043": { name: "DuPage", state: "IL" },
  "17197": { name: "Will", state: "IL" },
  "17201": { name: "Winnebago", state: "IL" },
  "17007": { name: "Boone", state: "IL" },
  "17000": { name: "Illinois, statewide", state: "IL" },
  "26163": { name: "Wayne", state: "MI" },
  "36067": { name: "Onondaga", state: "NY" },
  "55079": { name: "Milwaukee", state: "WI" },
};

export function countyName(fips: string): string {
  const county = COUNTIES[fips];
  return county ? `${county.name}, ${county.state}` : `FIPS ${fips}`;
}

function joinWords(words: string[]): string {
  if (words.length === 1) return words[0] as string;
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/**
 * How a tenant's coverage reads inside a sentence.
 *
 * Repeating the state after every county turns Vince's three counties into
 * "Cook, IL, DuPage, IL, and Will, IL", which is how a subject line ends up
 * looking machine generated. When they share a state it is said once.
 */
export function countiesLabel(fipsList: string[]): string {
  if (fipsList.length === 0) return "your counties";

  const known = fipsList.map((fips) => COUNTIES[fips]).filter((c): c is County => Boolean(c));
  if (known.length !== fipsList.length) {
    return joinWords(fipsList.map(countyName));
  }

  if (known.length === 1) {
    const only = known[0] as County;
    return `${only.name}, ${only.state}`;
  }

  const states = new Set(known.map((county) => county.state));
  const names = joinWords(known.map((county) => county.name));
  return states.size === 1
    ? `${names} counties, ${[...states][0]}`
    : joinWords(known.map((county) => `${county.name}, ${county.state}`));
}
