// SearchInput — the ONE search box in the app.
//
// Header global search, every list toolbar, every filter bar. Never a bare
// Input with placeholder="Search…": the leading magnifier, the width and the
// control height all come from here (.gs-wrap / .gs-icon / .innovic-input
// .gs-input), so all 138 screens search-looking the same is a property of this
// file, not of each screen.
//
// Controlled: the caller owns `value`, this box only reports keystrokes.
// `debounceMs` delays the report (the term still appears in the box at once),
// which is what a list that refetches per keystroke wants. The delay itself is
// apps/web/src/lib/use-debounce.ts — the shared hook — over a local draft; the
// draft is what makes the box respond at once while the report lags.
//
// RESET SEMANTICS — read this before wiring a Clear-filters button.
//   • A `value` the box did not itself report (a term restored from the URL, a
//     parent that rewrote the term) replaces what is in the box and cancels any
//     pending report. That is the `value !== reported` effect below.
//   • A parent reset to a value EQUAL to the last reported term is invisible
//     from props: `setTerm('')` when the term is already '' changes no prop, so
//     no effect of ours can run and a still-pending keystroke would land after
//     the clear and re-apply the filter the user just cleared. A parent that
//     can do that passes `resetKey` (bump it in the Clear handler) — that is
//     the reset signal, and it is the only thing that closes the hole.
//
// Width sits on the WRAPPER (design-ref/components/forms/SearchInput.jsx:4), so
// the .gs-wrap div and the box are the same size; the input then fills it. Put
// a width on the input alone and the wrapper still stretches to its container,
// leaving an invisible full-width block shoving the siblings along.

import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '../core/Icon';
import { useDebounce } from '@/lib/use-debounce';
import { cx } from './class-names';

/**
 * Box width, on the wrapper: the two field tokens wide enough to hold the 28px
 * magnifier gutter plus real typing room, 'full' to fill a container, or a
 * pixel number — the design-ref escape hatch (`<SearchInput width={190} />`).
 *
 * --field-xs (64px) and --field-sm (104px) are deliberately NOT offered. A
 * search box always carries .gs-input's `padding-left: 28px` for the
 * magnifier, so an xs box has ~28px of typing room; the design-ref d.ts
 * documents only the --field-lg default and offers no size ladder at all.
 * Anything else (a percentage, a var()) goes through `style` instead, so it is
 * visibly a one-off rather than a sanctioned size.
 */
export type SearchInputWidth = 'md' | 'lg' | 'full' | number;

const WIDTH_VALUE: Record<'md' | 'lg' | 'full', string> = {
  md: 'var(--field-md)',
  lg: 'var(--field-lg)',
  full: '100%',
};

export interface SearchInputProps {
  value?: string | undefined;
  /** Fires with the term, after `debounceMs` if one is set. */
  onChange?: ((value: string) => void) | undefined;
  /** "Search this list…" · "Search anything… (Ctrl+K)" · domain-specific. */
  placeholder?: string | undefined;
  /** Pause after the last keystroke before onChange fires. 0 = every keystroke. */
  debounceMs?: number | undefined;
  /** Width on the wrapper. Default --field-lg. */
  width?: SearchInputWidth | undefined;
  /**
   * Bump this (any new value) to force the box back to `value` and drop a
   * pending report — a Clear-filters button that resets the term to what it
   * already was. Nothing else can express that; see RESET SEMANTICS above.
   */
  resetKey?: string | number | undefined;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  maxLength?: number | undefined;
  'aria-label'?: string | undefined;
  className?: string | undefined;
  /** Merged onto the wrapper, after `width` (design-ref API). */
  style?: CSSProperties | undefined;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement> | undefined;
  onFocus?: React.FocusEventHandler<HTMLInputElement> | undefined;
  onBlur?: React.FocusEventHandler<HTMLInputElement> | undefined;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value = '',
    onChange,
    placeholder = 'Search this list…',
    debounceMs = 0,
    width = 'lg',
    resetKey,
    id,
    name,
    disabled = false,
    autoFocus = false,
    maxLength,
    'aria-label': ariaLabel = 'Search',
    className,
    style,
    onKeyDown,
    onFocus,
    onBlur,
  },
  ref,
) {
  // What is in the box right now. It runs ahead of `value` while a debounced
  // report is still pending.
  const [draft, setDraft] = useState(value);
  // The last term this box handed to the caller; anything else arriving in
  // `value` is the caller changing the term itself.
  const reported = useRef(value);

  // The last `value` we have acted on. A `value` that differs from it is an
  // external change this commit has not applied yet — the report below stands
  // down for it, so a keystroke that settles in the very same commit cannot
  // fire after the caller has already moved the term somewhere else.
  const seenValue = useRef(value);

  // The shared debounce (lib/use-debounce.ts). Changing `draft` restarts it, so
  // replacing the draft — any reset — also drops whatever report was pending;
  // there is no timer of our own left to forget to clear.
  const settled = useDebounce(draft, debounceMs);
  // `settled` trails `draft` while the user is still typing. Only a draft the
  // debounce has caught up with is a term worth reporting.
  const ready = debounceMs <= 0 || settled === draft;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Report. Guarded on `reported`, so re-renders and the caller echoing our own
  // term back as `value` never re-fire it.
  useEffect(() => {
    if (!ready) return;
    if (value !== seenValue.current) return;
    if (draft === reported.current) return;
    reported.current = draft;
    onChangeRef.current?.(draft);
  }, [ready, draft, value]);

  // The caller changed the term itself: adopt it. Because that replaces the
  // draft, the pending report dies with it.
  useEffect(() => {
    if (value === seenValue.current) return;
    seenValue.current = value;
    if (value === reported.current) return;
    reported.current = value;
    setDraft(value);
  }, [value]);

  // The same thing, for the reset a prop change cannot express — a parent
  // clearing the term back to the term it already reported.
  const seenResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === seenResetKey.current) return;
    seenResetKey.current = resetKey;
    reported.current = value;
    setDraft(value);
  }, [resetKey, value]);

  const wrapWidth =
    width === 'md' || width === 'lg' || width === 'full' ? WIDTH_VALUE[width] : width;
  const wrapStyle: CSSProperties =
    width === 'full'
      ? // .gs-wrap is flex-shrink:0; a full-width box inside a flex toolbar has
        // to be allowed to shrink or it pushes the row wider than the page.
        { width: '100%', flexShrink: 1, minWidth: 0, ...style }
      : { width: wrapWidth, ...style };

  return (
    <div className="gs-wrap" style={wrapStyle}>
      {/* ui/core/Icon — the one control-icon source. .gs-icon parks it in the
          box and makes it click-through. */}
      <Icon name="search" size={14} className="gs-icon" />
      <input
        ref={ref}
        type="text"
        id={id}
        name={name}
        className={cx('innovic-input', 'gs-input', className)}
        // .innovic-input.gs-input fixes the width at --field-lg; the wrapper
        // owns it now, so the box fills whatever the wrapper is.
        style={{ width: '100%' }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={maxLength}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </div>
  );
});
