/** Weights are stored as integer grams. Display units are converted at the edges only. */

export type WeightUnit = 'kg' | 'lb';

export const GRAMS_PER_LB = 453.59237;
export const MIN_WEIGHT_G = 20_000;
export const MAX_WEIGHT_G = 400_000;

export function isValidWeightG(g: number): boolean {
  return Number.isInteger(g) && g >= MIN_WEIGHT_G && g <= MAX_WEIGHT_G;
}

export function assertWeightG(g: number): number {
  if (!isValidWeightG(g)) {
    throw new RangeError(`Weight must be an integer number of grams in ${MIN_WEIGHT_G}..${MAX_WEIGHT_G}`);
  }
  return g;
}

/** Converts a user-entered value (e.g. 82.4 kg or 181.6 lb) to integer grams. */
export function toGrams(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Weight must be a positive number');
  const g = unit === 'kg' ? value * 1000 : value * GRAMS_PER_LB;
  return Math.round(g);
}

export function fromGrams(g: number, unit: WeightUnit, decimals = 1): number {
  const v = unit === 'kg' ? g / 1000 : g / GRAMS_PER_LB;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function formatWeight(g: number, unit: WeightUnit, decimals = 1): string {
  return `${fromGrams(g, unit, decimals).toFixed(decimals)} ${unit}`;
}

/** Signed delta, e.g. "−0.4 kg" / "+1.2 kg". */
export function formatDelta(g: number, unit: WeightUnit, decimals = 1): string {
  const v = fromGrams(Math.abs(g), unit, decimals);
  if (v === 0) return `0.${'0'.repeat(decimals)} ${unit}`;
  return `${g < 0 ? '−' : '+'}${v.toFixed(decimals)} ${unit}`;
}
