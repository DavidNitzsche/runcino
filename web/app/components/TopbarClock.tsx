'use client';

import { useEffect, useState } from 'react';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function format(d: Date) {
  const dow = DOW[d.getDay()];
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const dispH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = `${dispH}:${m.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
  return { dow, date, time };
}

export function TopbarClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span style={{ opacity: 0.4 }}>, </span>;
  const f = format(now);
  return (
    <>
      {f.dow} · {f.date} · <b>{f.time}</b>
    </>
  );
}
