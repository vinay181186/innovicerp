// The Day Log's time box (owner 2026-10-26: AM/PM). A typed text field: the
// user may type "930", "3pm", "3:15 pm", "1530" or "03:15 PM"; on blur it is
// tidied to "03:15 PM" (shared fmt12) through the shared parseTime. Never a
// browser type="time". The parent keeps the raw text and reads
// parseTime(value) — 24-hour "HH:MM" for the API, null = "not a time yet".
//
// The 🕒 button opens an Hour (01–12) · Minute (5-min) · AM/PM picker with
// Now and Set. `nowMin` (today only) greys every time after now. The picker
// hangs from the field's RIGHT edge and opens leftwards (it was cut off at
// the screen's right edge); when there is no room on the left either it
// hangs from the left edge instead.
//
// LockedTime is the read-only look for a time the user may not change.

import { fmt12, hhmmToMin, minToHhmm, parseTime } from '@innovic/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const two = (n: number): string => String(n).padStart(2, '0');
/** 12-hour clock hour + AM/PM → 0–23. */
const to24 = (h12: number, pm: boolean): number => (h12 % 12) + (pm ? 12 : 0);
const PICKER_W = 280;

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

function TimePicker({
  value,
  nowMin,
  side,
  onSet,
}: {
  value: string;
  nowMin: number | null;
  side: 'right' | 'left';
  onSet: (t: string) => void;
}): React.JSX.Element {
  const start = parseTime(value);
  const startMin = start ? hhmmToMin(start) : (nowMin ?? 9 * 60);
  const [h, setH] = useState(Math.floor(startMin / 60));
  const [m, setM] = useState(Math.floor((startMin % 60) / 5) * 5);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
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
      className="ss-list"
      style={{
        width: PICKER_W,
        maxWidth: 'calc(100vw - 16px)',
        ...(side === 'right' ? { right: 0, left: 'auto' } : { left: 0, right: 'auto' }),
        padding: 8,
        maxHeight: 'none',
      }}
    >
      <div className="mono fw-700" style={{ fontSize: 'var(--fs-lg)', textAlign: 'center' }}>
        {fmt12(minToHhmm(h * 60 + m))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
        <div>
          <div style={COL_HEAD}>Hour</div>
          <div style={COL}>
            {HOURS12.map((x) =>
              opt(two(x), x === h12, after(to24(x, pm) * 60), () => goHour(to24(x, pm)), x === h12),
            )}
          </div>
        </div>
        <div>
          <div style={COL_HEAD}>Minute</div>
          <div style={COL}>
            {MINUTES.map((x) => opt(two(x), x === m, after(h * 60 + x), () => setM(x)))}
          </div>
        </div>
        <div>
          <div style={COL_HEAD}>AM/PM</div>
          <div style={COL}>
            {opt('AM', !pm, false, () => goHour(to24(h12, false)))}
            {opt('PM', pm, after(to24(h12, true) * 60), () => goHour(to24(h12, true)))}
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
}

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
  /** Enter pressed with a valid time in the box. */
  onEnter?: (() => void) | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'right' | 'left'>('right');
  const boxRef = useRef<HTMLDivElement>(null);
  const bad = value.trim() !== '' && parseTime(value) === null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Open leftwards from the right edge; only when that would run off the
  // left of the screen, hang from the left edge instead.
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const w = Math.min(PICKER_W, window.innerWidth - 16);
    setSide(r.right - w >= 8 ? 'right' : 'left');
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
          if (tidy()) onEnter();
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
      {open ? (
        <TimePicker
          value={value}
          nowMin={nowMin}
          side={side}
          onSet={(t) => {
            onChange(fmt12(t));
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
