import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatInputDate, parseInputDate } from '../utils/dateUtils';
import {
  DEFAULT_MONTH_NAMES,
  DEFAULT_WEEKDAY_LABELS,
  addDays,
  isValidIso,
  monthLabel,
  monthMatrix,
  monthViewOf,
  shiftMonth,
  todayIso,
  type MonthView,
} from '../../../shared/calendarGrid';

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  title?: string;
  style?: any;
  /** Test hook — the id the end-to-end suite looks for. */
  'data-testid'?: string;
}

interface PopupPos {
  left: number;
  top: number;
}

const POPUP_WIDTH = 272;

/**
 * The date field EVERY screen uses.
 *
 * Clicking the field opens a real calendar (a themed popup, not the browser's
 * grey OS widget) and the owner can also keep typing the date as before — the
 * typed text and the calendar always agree, because both go through the same
 * `parseInputDate()` / `formatInputDate()` helpers.
 *
 * The popup is rendered in a portal on `document.body` with `position: fixed`,
 * so it is NEVER clipped by the scrolling body of a modal (the Purchase Order
 * modal) or by a page that scrolls. It flips above the field when there is no
 * room below.
 */
export function DateInput({
  value,
  onChange,
  className = 'inp',
  placeholder,
  title,
  style,
  'data-testid': testId,
}: DateInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(formatInputDate(value));
  const [open, setOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const [view, setView] = useState<MonthView>(
    () => monthViewOf(value) || monthViewOf(todayIso()) || { year: 1970, month: 1 }
  );
  const [focusIso, setFocusIso] = useState<string>(() => (isValidIso(value) ? value : todayIso()));
  const [pos, setPos] = useState<PopupPos>({ left: 0, top: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setText(formatInputDate(value));
    if (isValidIso(value)) setFocusIso(value);
  }, [value]);

  const monthNames = useMemo(() => {
    const raw = t('calendar.months', { returnObjects: true }) as unknown;
    return Array.isArray(raw) && raw.length === 12 ? (raw as string[]) : DEFAULT_MONTH_NAMES;
  }, [t]);

  const weekdayLabels = useMemo(() => {
    const raw = t('calendar.weekdays', { returnObjects: true }) as unknown;
    return Array.isArray(raw) && raw.length === 7 ? (raw as string[]) : DEFAULT_WEEKDAY_LABELS;
  }, [t]);

  const commit = (next: string) => {
    const iso = parseInputDate(next);
    if (iso) {
      onChange(iso);
    } else if (next.trim() === '') {
      onChange('');
    } else {
      // Invalid input: revert to the last committed value.
      setText(formatInputDate(value));
    }
  };

  const reposition = useCallback(() => {
    const input = inputRef.current;
    const pop = popRef.current;
    if (!input || !pop) return;
    const r = input.getBoundingClientRect();
    const pw = pop.offsetWidth || POPUP_WIDTH;
    const ph = pop.offsetHeight || 300;
    const margin = 8;
    let left = r.left;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (left < margin) left = margin;
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - margin) {
      const up = r.top - ph - 4;
      top = up >= margin ? up : Math.max(margin, window.innerHeight - ph - margin);
    }
    setPos({ left, top });
  }, []);

  // The popup is placed right after it is mounted (a layout effect, so it never
  // shows up in the wrong corner for a frame) and it follows the field while
  // the owner scrolls the page.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, view.year, view.month, reposition]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition]);

  // A click anywhere outside the field and the popup closes the calendar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target)) return;
      if (inputRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const openCalendar = useCallback(
    (byKeyboard: boolean) => {
      const v = isValidIso(value) ? value : todayIso();
      const m = monthViewOf(v);
      setFocusIso(v);
      if (m) setView(m);
      setOpenedByKeyboard(byKeyboard);
      setOpen(true);
    },
    [value]
  );

  const choose = (iso: string) => {
    onChange(iso);
    setFocusIso(iso);
    setOpen(false);
    inputRef.current?.focus();
  };

  const clearDate = () => {
    onChange('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const stepFocus = (delta: number) => {
    const base = isValidIso(focusIso) ? focusIso : todayIso();
    const next = addDays(base, delta);
    setFocusIso(next);
    const m = monthViewOf(next);
    if (m) setView(m);
  };

  const stepMonth = (delta: number) => {
    const next = shiftMonth(view.year, view.month, delta);
    setView(next);
    const m = monthViewOf(focusIso);
    if (m && (m.year !== next.year || m.month !== next.month)) {
      const day = isValidIso(focusIso)
        ? Math.min(Number(focusIso.slice(8, 10)), new Date(next.year, next.month, 0).getDate())
        : 1;
      const iso = `${next.year}-${String(next.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      setFocusIso(iso);
    }
  };

  const weeks = useMemo(() => monthMatrix(view.year, view.month), [view.year, view.month]);
  const today = todayIso();

  const popup = open
    ? createPortal(
        <div
          className="datecal"
          data-testid="datecal"
          role="dialog"
          aria-label={t('calendar.pick', 'Pick a date')}
          ref={popRef}
          style={{ left: pos.left, top: pos.top }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="datecal-head">
            <button
              type="button"
              className="datecal-nav"
              data-testid="datecal-prev"
              aria-label={t('calendar.prev_month', 'Previous month')}
              onClick={() => stepMonth(-1)}
            >
              ‹
            </button>
            <div className="datecal-title" data-testid="datecal-title">
              {monthLabel(view.year, view.month, monthNames)}
            </div>
            <button
              type="button"
              className="datecal-nav"
              data-testid="datecal-next"
              aria-label={t('calendar.next_month', 'Next month')}
              onClick={() => stepMonth(1)}
            >
              ›
            </button>
          </div>

          <div className="datecal-week" aria-hidden="true">
            {weekdayLabels.map((w, i) => (
              <span className="datecal-wd" key={`wd-${i}`}>
                {w}
              </span>
            ))}
          </div>

          <div className="datecal-grid" data-testid="datecal-grid">
            {weeks.map((week, wi) =>
              week.map((d) => (
                <button
                  type="button"
                  key={d.iso}
                  className={
                    'datecal-day' +
                    (d.inMonth ? '' : ' datecal-out') +
                    (d.iso === value ? ' datecal-sel' : '') +
                    (d.iso === focusIso ? ' datecal-focus' : '') +
                    (d.iso === today ? ' datecal-today' : '')
                  }
                  data-testid={`datecal-day-${d.iso}`}
                  data-date={d.iso}
                  aria-label={d.iso}
                  onClick={() => choose(d.iso)}
                >
                  {d.day}
                </button>
              ))
            )}
          </div>

          <div className="datecal-foot">
            <button type="button" data-testid="datecal-today-btn" onClick={() => choose(today)}>
              {t('calendar.today', 'Today')}
            </button>
            <button type="button" data-testid="datecal-clear-btn" onClick={clearDate}>
              {t('calendar.clear', 'Clear')}
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <input
        ref={inputRef}
        className={className}
        title={title}
        style={style}
        data-testid={testId}
        placeholder={placeholder || formatInputDate('2000-01-01')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onClick={() => openCalendar(false)}
        onBlur={(e) => {
          commit(e.target.value);
          window.setTimeout(() => {
            const active = document.activeElement;
            if (active && popRef.current?.contains(active)) return;
            if (active === inputRef.current) return;
            setOpen(false);
          }, 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            e.stopPropagation();
            openCalendar(true);
            return;
          }
          if (open) {
            if (e.key === 'ArrowLeft') { stepFocus(-1); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === 'ArrowRight') { stepFocus(1); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === 'ArrowUp') { stepFocus(-7); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === 'ArrowDown') { stepFocus(7); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === 'PageUp') { stepMonth(-1); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === 'PageDown') { stepMonth(1); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === 'Enter') {
              // The typed date always wins (the old behaviour). Only a calendar
              // opened with the keyboard picks the highlighted day on Enter, so
              // the forms' Enter-to-next-field still works.
              if (parseInputDate(e.currentTarget.value)) {
                commit(e.currentTarget.value);
                return;
              }
              if (openedByKeyboard && isValidIso(focusIso)) {
                e.preventDefault();
                e.stopPropagation();
                choose(focusIso);
                return;
              }
            }
          }
          if (e.key === 'Enter') commit(e.currentTarget.value);
        }}
      />
      {popup}
    </>
  );
}
