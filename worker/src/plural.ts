/**
 * Pluralises the lead nouns the presets use.
 *
 * Appending an s naively turns "loss" into "losss" and "property" into
 * "propertys", which is the kind of thing that lands in a paying customer's
 * inbox at 6:30 in the morning. The four launch presets use loss, property, job,
 * and filing, and this covers all of them plus the obvious near misses.
 */
export function plural(noun: string, count: number): string {
  if (count === 1) return noun;

  if (/(?:s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** "1 loss" or "5 losses". */
export function countOf(noun: string, count: number): string {
  return `${count} ${plural(noun, count)}`;
}
