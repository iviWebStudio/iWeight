import {
  daysBetween,
  fromGrams,
  isValidWeightG,
  localTimeInTimeZone,
  MAX_WEIGHT_G,
  MIN_WEIGHT_G,
  toGrams,
  type WeightUnit,
  zonedTimeToUtc,
} from '@weight-ai/core';

const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const unitLabel = (u: WeightUnit) => (u === 'kg' ? 'кг' : 'lb');
export const num = (g: number, u: WeightUnit) => nf1.format(fromGrams(g, u, 1));
export const weight = (g: number, u: WeightUnit) => `${num(g, u)} ${unitLabel(u)}`;
export function delta(g: number, u: WeightUnit): string {
  const v = fromGrams(Math.abs(g), u, 1);
  if (v === 0) return `0,0 ${unitLabel(u)}`;
  return `${g < 0 ? '−' : '+'}${nf1.format(v)} ${unitLabel(u)}`;
}
export const perWeek = (gPerDay: number, u: WeightUnit) =>
  `${delta(Math.round(gPerDay * 7), u)}/нед`;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_FULL = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
export function dShort(d: string): string {
  const [, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
}
export const dLong = (d: string) => `${dShort(d)} ${d.slice(0, 4)}`;
export function dRel(d: string, today: string): string {
  const n = daysBetween(d, today);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'вчера';
  if (n === 2) return 'позавчера';
  return dShort(d);
}
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
export const meas = (n: number) => `${n} ${plural(n, 'измерение', 'измерения', 'измерений')}`;

/** Parses "78,4" / "78.4" in the user's unit into grams, or returns an error message. */
export function parseWeight(raw: string, u: WeightUnit): { g: number } | { error: string } {
  const v = Number(raw.replace(',', '.').trim());
  if (!raw.trim() || !Number.isFinite(v) || v <= 0)
    return { error: 'Введите число, например 78,4.' };
  const g = toGrams(v, u);
  if (!isValidWeightG(g))
    return {
      error: `Вес должен быть от ${weight(MIN_WEIGHT_G, u)} до ${weight(MAX_WEIGHT_G, u)}.`,
    };
  return { g };
}

export function nowTimeIn(tz: string): string {
  return localTimeInTimeZone(new Date(), tz);
}
export { localTimeInTimeZone as localTime };

/** ISO instant of a wall-clock date + HH:MM in the user's zone. */
export const zonedToUtc = (date: string, time: string, tz: string) =>
  zonedTimeToUtc(date, time, tz).toISOString();
