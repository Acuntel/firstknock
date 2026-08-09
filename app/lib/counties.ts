/**
 * Display names for the county FIPS codes V1 covers, from
 * ben/DESIGN_PARTNERS.md. A code with no entry falls back to the raw FIPS,
 * which is at least unambiguous.
 */
const COUNTY_NAMES: Record<string, string> = {
  "17031": "Cook, IL",
  "17043": "DuPage, IL",
  "17197": "Will, IL",
  "17201": "Winnebago, IL",
  "17007": "Boone, IL",
  "17000": "Illinois, statewide",
  "26163": "Wayne, MI",
};

export function countyName(fips: string): string {
  return COUNTY_NAMES[fips] ?? `FIPS ${fips}`;
}
