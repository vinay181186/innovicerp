// The Day Log's time box (owner 2026-10-26: AM/PM). A typed text field: the
// user may type "930", "3pm", "3:15 pm", "1530" or "03:15 PM"; on blur it is
// tidied to "03:15 PM" (shared fmt12) through the shared parseTime. Never a
// browser type="time". The parent keeps the raw text and reads
// parseTime(value) — 24-hour "HH:MM" for the API, null = "not a time yet".
//
// The 🕒 button opens an Hour ("09 AM" … "11 PM") · Minute (5-min) picker with
// Now and Set. `nowMin` (today only) greys every time after now. The picker
// is drawn on <body> at a fixed spot next to the field (the sheet's table
// scrolls and would clip it): right edges lined up, opening downwards, and
// moved so it always stays on screen — upwards when there is no room below,
// rightwards when there is none on the left.
//
// LockedTime is the read-only look for a time the user may not change.

import { fmt12, hhmmToMin, minToHhmm, parseTime } from '@innovic/shared';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HOURS24 = Array.from({ length: 24 }, (_, i) => i);
/** 13 → "01 PM". */
const hourLabel = (h: number): string =>
  `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const two = (n: number): string => String(n).padStart(2, '0');
const PICKER_W = 280;
/** About the picker's height, for choosing above / below. */
const PICKER_H = 300;
const EDGE = 8;

type PickerPos = { left: number; top: number } | { left: number; bottom: number };

const BOX: React.CSSProperties = { width: '14ch', minWidth: 120 };
const COL: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  maxHeight: 190,
  overflowY: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 3,
};
const COL_HEAD: React.CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 700,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  textAlign: 'center',
};

/** A time shown read-only: the locked look, no picker. */
export function LockedTime({
  id,
  ariaLabel,
  value,
  title,
}: {
  id?: string | undefined;
  ariaLabel: string;
  /** 24-hour "HH:MM", or null = no time. */
  value: string | null;
  title: string;
}): React.JSX.Element {
  return (
    <input
      id={id}
      type="text"
      readOnly
      className="innovic-input mono"
      aria-label={ariaLabel}
      title={title}
      value={value ? fmt12(value) : ''}
      placeholder="—"
      style={BOX}
    />
  );
}

const TimePicker = forwardRef<
  HTMLDivElement,
  { value: string; nowMin: number | null; pos: PickerPos; onSet: (t: string) => void }
>(function TimePicker({ value, nowMin, pos, onSet }, ref): React.JSX.Element {
  const start = parseTime(value);
  const startMin = start ? hhmmToMin(start) : (nowMin ?? 9 * 60);
  const [h, setH] = useState(Math.floor(startMin / 60));
  const [m, setM] = useState(Math.floor((startMin % 60) / 5) * 5);
  const after = (min: number): boolean => nowMin !== null && min > nowMin;
  const hourRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    hourRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  /** Move to hour `nh` (0–23); drop the minute to :00 when it would pass now. */
  const goHour = (nh: number): void => {
    setH(nh);
    if (after(nh * 60 + m)) setM(0);
  };

  const opt = (label: string, on: boolean, off: boolean, pick: () => void, ref?: boolean) => (
    <button
      key={label}
      ref={ref ? hourRef : undefined}
      type="button"
      className={`ss-opt mono${on ? ' hl' : ''}`}
      disabled={off}
      onClick={pick}
      style={{
        border: 0,
        borderRadius: 'var(--radius-sm)',
        background: on ? undefined : 'transparent',
        opacity: off ? 0.35 : 1,
        cursor: off ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="ss-list"
      style={{
        position: 'fixed',
        ...pos,
        right: 'auto',
        width: PICKER_W,
        maxWidth: `calc(100vw - ${2 * EDGE}px)`,
        padding: 8,
        maxHeight: 'none',
      }}
    >
      <div className="mono fw-700" style={{ fontSize: 'var(--fs-lg)', textAlign: 'center' }}>
        {fmt12(minToHhmm(h * 60 + m))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 6, marginTop: 6 }}>
        <div>
          <div style={COL_HEAD}>Hour</div>
          <div style={COL}>
            {/* One list, AM/PM on each hour — any earlier hour is one click
                away (a separate AM/PM switch greyed them in the afternoon). */}
            {HOURS24.map((x) =>
              opt(hourLabel(x), x === h, after(x * 60), () => goHour(x), x === h),
            )}
          </div>
        </div>
        <div>
          <div style={COL_HEAD}>Minute</div>
          <div style={COL}>
            {MINUTES.map((x) => opt(two(x), x === m, after(h * 60 + x), () => setM(x)))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {nowMin !== null ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onSet(minToHhmm(nowMin))}
          >
            Now {fmt12(minToHhmm(nowMin))}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={after(h * 60 + m)}
          onClick={() => onSet(minToHhmm(h * 60 + m))}
        >
          Set
        </button>
      </div>
    </div>
  );
});

export function TimeField({
  value,
  onChange,
  id,
  ariaLabel,
  disabled,
  placeholder = '09:00 AM',
  nowMin = null,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string | undefined;
  ariaLabel?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  /** Today: the live server minute — later times are greyed in the picker. */
  nowMin?: number | null | undefined;
  /** Enter pressed with a valid time, or nothing, in the box. */
  onEnter?: (() => void) | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PickerPos | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const bad = value.trim() !== '' && parseTime(value) === null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Where the picker goes, on screen. Re-measured on any scroll (capture:
  // the table's own scroller too) and on resize.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    const measure = (): void => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(PICKER_W, window.innerWidth - 2 * EDGE);
      const left = Math.max(EDGE, Math.min(window.innerWidth - w - EDGE, r.right - w));
      const below = window.innerHeight - r.bottom - EDGE;
      setPos(
        below < PICKER_H && r.top - EDGE > below
          ? { left, bottom: window.innerHeight - r.top + 4 }
          : { left, top: r.bottom + 4 },
      );
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  const tidy = (): string | null => {
    const t = parseTime(value);
    if (t && fmt12(t) !== value) onChange(fmt12(t));
    return t;
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        className="innovic-input mono"
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        title={bad ? 'Type a time, e.g. 930, 3pm, 3:15 pm or 1530' : undefined}
        placeholder={placeholder}
        maxLength={9}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void tidy()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key !== 'Enter' || !onEnter) return;
          e.preventDefault();
          if (value.trim() === '' || tidy()) onEnter();
        }}
        style={{
          ...BOX,
          paddingRight: 30,
          ...(bad ? { borderColor: 'var(--red)' } : {}),
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={`Pick ${ariaLabel ?? 'time'}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'absolute',
          right: 2,
          top: '50%',
          transform: 'translateY(-50%)',
          padding: '0 4px',
        }}
      >
        🕒
      </button>
      {open && pos
        ? createPortal(
            <TimePicker
              ref={popRef}
              value={value}
              nowMin={nowMin}
              pos={pos}
              onSet={(t) => {
                onChange(fmt12(t));
                setOpen(false);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
