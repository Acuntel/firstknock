import type { PropertyCategory } from "./types";

/**
 * Cook County assessor class codes, grouped into the categories the presets
 * weight against.
 *
 * The leading digit carries the meaning. From the assessor's classification
 * code book: 1 is vacant land, 2 is residential up to six units, 3 is larger
 * multifamily, 4 is not for profit, 5 is commercial and industrial, and 6
 * through 8 are incentive classes for development.
 *
 * Class 5 covers both commercial and industrial without distinguishing them by
 * code, so it maps to commercial. Overstating industrial would quietly
 * penalise ordinary storefronts under the investor preset, which weights
 * industrial lowest.
 */
function cookCategory(code: string): PropertyCategory {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 0) return "unknown";

  // Codes are two or three digits. A leading zero means exempt or vacant.
  const lead = digits.length >= 3 ? digits[0] : "0";

  switch (lead) {
    case "1":
      return "vacant";
    case "2":
      return "residential";
    case "3":
      return "multifamily";
    case "4":
      return "nonprofit";
    case "5":
      return "commercial";
    case "6":
      return "industrial";
    case "7":
    case "8":
      return "commercial";
    default:
      return "unknown";
  }
}

/**
 * Resolves the use category for a property.
 *
 * An explicit category from the adapter wins, because that means the source
 * stated the use type itself rather than encoding it in a class code. Cook
 * permits are the case: no assessor class at all, but the record says
 * "COMMERCIAL PERMIT" in as many words.
 *
 * Falling back to class codes, only Cook is mapped today because Cook is the
 * only pack that exists. Every other county returns unknown, which the presets
 * weight at 1.0, so an unmapped county stays neutral rather than being scored as
 * if its codes meant the same thing Cook's do. Each new pack adds a branch here.
 */
export function propertyCategory(
  fips: string,
  classCode: string | undefined,
  stated?: PropertyCategory,
): PropertyCategory {
  if (stated) return stated;
  if (!classCode) return "unknown";
  if (fips === "17031") return cookCategory(classCode);
  return "unknown";
}
