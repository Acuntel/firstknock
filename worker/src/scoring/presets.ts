import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ScoreWeights, VerticalPreset } from "./types";

const PRESET_DIR = fileURLToPath(new URL("../../../presets", import.meta.url));

export const PRESET_IDS = ["restoration", "investors", "roofing", "lawfirms"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/**
 * Validates the parts of a preset that scoring depends on.
 *
 * Loud on purpose. A preset with a missing weight would not crash, it would
 * quietly score every lead for that tenant wrong, and nobody would notice until
 * a design partner said the digest felt off.
 */
function validate(preset: VerticalPreset, id: string): VerticalPreset {
  const problems: string[] = [];

  if (preset.id !== id) problems.push(`id is "${preset.id}", expected "${id}"`);
  if (!Array.isArray(preset.eventTypes) || preset.eventTypes.length === 0) {
    problems.push("eventTypes is empty");
  }

  const weights = preset.weights;
  if (!weights) problems.push("weights is missing");
  else {
    if (typeof weights.freshnessHalfLifeHours !== "number" || weights.freshnessHalfLifeHours <= 0) {
      problems.push("freshnessHalfLifeHours must be a positive number");
    }
    if (typeof weights.distanceDecayMiles !== "number" || weights.distanceDecayMiles <= 0) {
      problems.push("distanceDecayMiles must be a positive number");
    }
    if (!weights.eventSeverity || Object.keys(weights.eventSeverity).length === 0) {
      problems.push("eventSeverity is empty");
    }
    // Every event type the preset claims to serve needs a severity, or the
    // vertical would advertise a signal it then scores at zero.
    for (const type of preset.eventTypes ?? []) {
      if (typeof weights.eventSeverity?.[type] !== "number") {
        problems.push(`eventSeverity is missing ${type}, which is in eventTypes`);
      }
    }
    if (!weights.propertyClassFit?.unknown) {
      problems.push("propertyClassFit needs an unknown fallback");
    }
  }

  if (typeof preset.hotPingDefault !== "number") problems.push("hotPingDefault is missing");
  if (typeof preset.digest?.topN !== "number") problems.push("digest.topN is missing");

  if (problems.length > 0) {
    throw new Error(`Preset ${id} is invalid: ${problems.join("; ")}`);
  }
  return preset;
}

const cache = new Map<string, VerticalPreset>();

export function loadPreset(id: string): VerticalPreset {
  const cached = cache.get(id);
  if (cached) return cached;

  let raw: string;
  try {
    raw = readFileSync(join(PRESET_DIR, `${id}.json`), "utf8");
  } catch {
    throw new Error(`No preset file for "${id}" in presets/`);
  }

  const preset = validate(JSON.parse(raw) as VerticalPreset, id);
  cache.set(id, preset);
  return preset;
}

export function loadAllPresets(): VerticalPreset[] {
  return PRESET_IDS.map((id) => loadPreset(id));
}

/**
 * Deep clone of a preset's weights.
 *
 * CUSTOMIZATION.md section 2 is explicit that presets are cloned onto the
 * tenant at onboarding "so later preset edits never surprise existing clients".
 * Returning a copy is what enforces that: a tenant tuning their own weights can
 * never reach back and mutate the shared preset.
 */
export function cloneWeights(weights: ScoreWeights): ScoreWeights {
  return structuredClone(weights);
}

/** Clones a preset's weights and applies tenant specific overrides on top. */
export function weightsFromPreset(
  presetId: string,
  override: (weights: ScoreWeights) => void = () => {},
): ScoreWeights {
  const weights = cloneWeights(loadPreset(presetId).weights);
  override(weights);
  return weights;
}
