import { useEffect, useRef, useState } from 'react';

interface LiveClockProps {
  refreshing?: boolean;
}

function isoParts(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}

export default function LiveClock({ refreshing = false }: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());
  const [tz, setTz] = useState('Asia/Karachi');
  const tzRef = useRef(tz);
  tzRef.current = tz;

  useEffect(() => {
    window.api.admin.settings
      .get('clock_timezone')
      .then((v) => {
        if (v) setTz(String(v));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  let timeLabel = '';
  let dateLabel = '';
  try {
    const zone = tzRef.current;
    timeLabel = now.toLocaleTimeString('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    const dateParts = isoParts(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).formatToParts(now)
    );
    dateLabel = `${dateParts.day}-${dateParts.month}-${dateParts.year}`;
  } catch {
    timeLabel = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    dateLabel = now.toLocaleDateString('en-GB');
  }

  if (refreshing) {
    return <span className="sale-inv-clock">Refreshing…</span>;
  }
  return (
    <span className="sale-inv-clock">
      <span className="sale-inv-time">{timeLabel}</span>
      <span className="sale-inv-date"> · {dateLabel}</span>
    </span>
  );
}