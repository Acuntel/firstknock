import { Onboarding, type CountyOption } from "@/components/onboarding";
import { loadAllPresets } from "@firstknock/worker/scoring/presets";
import { allAdapters } from "@firstknock/worker/registry";
import { countyName } from "@firstknock/worker/counties";

/** The V1 county list, with live meaning an adapter exists for it today. */
function counties(): CountyOption[] {
  const covered = new Set(allAdapters().map((adapter) => adapter.fips));
  const v1 = ["17031", "17043", "17197", "17201", "17007", "26163"];

  return v1.map((fips) => ({
    fips,
    label: countyName(fips),
    live: covered.has(fips),
  }));
}

const DETAILS: Record<string, string> = {
  restoration: "Fire and water losses, repair permits, distress signals",
  investors: "Foreclosure filings, judgments, tax delinquency, sales",
  roofing: "Building permits and recent sales in your radius",
  lawfirms: "New foreclosure filings and association registrations",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;

  const verticals = loadAllPresets().map((preset) => ({
    id: preset.id,
    label: preset.label,
    detail: DETAILS[preset.id] ?? "",
  }));

  return (
    <Onboarding verticals={verticals} counties={counties()} plan={plan ?? "pro"} />
  );
}
