// The Day Log's ONE time box: a typed 24-hour "HH:MM" text field. The user
// may type "1130", "11.30", "11:30" or "930"; on blur it is tidied to
// "11:30" / "09:30" through parseHhmm. Never a browser type="time" (it shows
// AM/PM on some PCs). The parent keeps the raw text and reads
// parseHhmm(value) — null means "not a time yet".

import { parseHhmm } from '../lib/format';

export function TimeField({
  value,
  onChange,
  id,
  ariaLabel,
  disabled,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string | undefined;
  ariaLabel?: string | undefined;
  disabled?: boolean | undefined;
  /** Enter pressed with a valid time in the box. */
  onEnter?: (() => void) | undefined;
}): React.JSX.Element {
  const bad = value.trim() !== '' && parseHhmm(value) === null;
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className="innovic-input mono"
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      title={bad ? 'Type a 24-hour time, e.g. 1130 or 11:30' : undefined}
      placeholder="HH:MM"
      maxLength={5}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const t = parseHhmm(value);
        if (t && t !== value) onChange(t);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !onEnter) return;
        const t = parseHhmm(value);
        if (!t) return;
        if (t !== value) onChange(t);
        onEnter();
      }}
      style={{
        width: '8ch',
        minWidth: 72,
        ...(bad ? { borderColor: 'var(--red)' } : {}),
      }}
    />
  );
}
