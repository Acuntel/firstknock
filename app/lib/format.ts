/**
 * Lead formatting lives in the worker, because the morning digest and the page
 * that digest links to have to describe a lead identically. Two copies of this
 * would drift within a phase.
 */
export {
  ageLabel,
  eventPlace,
  eventTitle,
  typeLabel,
  whyLine,
} from "@firstknock/worker/format";
