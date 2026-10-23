'use client';
import { useMemo } from 'react';

const COMMON = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Vladivostok',
  'Asia/Yerevan',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'UTC',
];

export function TimezoneSelect({
  id,
  value,
  onChange,
  name,
}: {
  id: string;
  value: string;
  onChange?: (v: string) => void;
  name?: string;
}) {
  const all = useMemo(() => {
    let list: string[] = [];
    try {
      list =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          'timeZone',
        ) ?? [];
    } catch {
      list = [];
    }
    return [...new Set([value, ...COMMON, ...list])];
  }, [value]);
  return (
    <select
      className="input"
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {all.map((t) => (
        <option key={t} value={t}>
          {t.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}
