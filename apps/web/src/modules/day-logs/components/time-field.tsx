// The Day Log's ONE time box: a typed 24-hour "HH:MM" text field. The user
// may type "1130", "11.30", "11:30" or "930"; on blur it is tidied to
// "11:30" / "09:30" through parseHhmm. Never a browser type="time" (it shows
// AM/PM on some PCs). The parent keeps the raw text and reads
// parseHhmm(value) — null means "not a time yet".
//
// The 🕒 button opens an Hour column + 5-minute column picker with Now and
// Set. `nowMin` (today only) greys every time after now.

import { hhmmToMin, minToHhmm } from '@innovic/shared';
import { useEffect, useRef, useState } from 'react';
import { parseHhmm } from '../lib/format';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const two = (n: number): string => String(n).padStart(2, '0');

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

function TimePicker({
  value,
  nowMin,
  onSet,
}: {
  value: string;
  nowMin: number | null;
  onSet: (t: string) => void;
}): React.JSX.Element {
  const start = parseHhmm(value);
  const startMin = start ? hhmmToMin(start) : (nowMin ?? 9 * 60);
  const [h, setH] = useState(Math.floor(startMin / 60));
  const [m, setM] = useState(Math.floor((startMin % 60) / 5) * 5);
  const after = (min: number): boolean => nowMin !== null && min > nowMin;
  const hourRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    hourRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

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
    <div className="ss-list" style={{ width: 236, right: 'auto', padding: 8, maxHeight: 'none' }}>
      <div className="mono fw-700" style={{ fontSize: 'var(--fs-lg)', textAlign: 'center' }}>
        {two(h)}:{two(m)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
        <div>
          <div style={COL_HEAD}>Hour</div>
          <div style={COL}>
            {HOURS.map((x) =>
              opt(
                two(x),
                x === h,
                after(x * 60),
                () => {
                  setH(x);
                  if (after(x * 60 + m)) setM(0);
                },
                x === h,
              ),
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
            Now {minToHhmm(nowMin)}
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
  placeholder = 'HH:MM',
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
  const boxRef = useRef<HTMLDivElement>(null);
  const bad = value.trim() !== '' && parseHhmm(value) === null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="innovic-input mono"
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        title={bad ? 'Type a 24-hour time, e.g. 1130 or 11:30' : undefined}
        placeholder={placeholder}
        maxLength={5}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const t = parseHhmm(value);
          if (t && t !== value) onChange(t);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key !== 'Enter' || !onEnter) return;
          const t = parseHhmm(value);
          if (!t) return;
          if (t !== value) onChange(t);
          onEnter();
        }}
        style={{
          width: '13ch',
          minWidth: 110,
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
          onSet={(t) => {
            onChange(t);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
