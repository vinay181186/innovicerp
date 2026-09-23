// DocNumberInput — the header field for every document code (IN-SO-00143,
// IN-MPO-00311 …), with live ✓ available / ✕ duplicate / format feedback.
//
// PHASE 2 SCOPE. Two exports, deliberately:
//
//   • `DocNumberInputView` — the design-ref shape: pure props, a `state` enum,
//     a `size` on the 12-column grid, no hook and no fetch. This is what the
//     kit page renders in all five states (idle / checking / ok / bad /
//     read-only), and it is the markup the live component's body becomes in
//     Phase 4.
//
//   • `DocNumberInput` — the LIVE component, re-exported unchanged from
//     `@/components/shared/doc-number-input`. It owns behaviour that is
//     test-verified in doc-number-input.test.tsx and catalogued in
//     audit/02-element-inventory.md §D.2: the `useDocNumber(type, value,
//     poType)` hook, prefill-the-next-code-while-empty, the PO series re-fill
//     when `poType` changes and the box still holds what we wrote, the blur
//     zero-pad ("IN-SO-126" → "IN-SO-00126"), the exact message strings and
//     `onValidityChange`. None of that is reimplemented here — screens keep
//     the same component, now reachable through the kit barrel.
//
// PHASE 4: point the live component's render at `DocNumberInputView` (mapping
// its hook state onto `state` / `message`) and delete the duplicated markup.
// It cannot happen now because that means editing the live file.

import { useId } from 'react';
import { Icon } from '../core/Icon';
import { FormField, type FormFieldSize } from './FormField';
import { Input } from './Input';

/** Width on the 12-column FormGrid. */
export type DocNumberInputSize = FormFieldSize;

/** Feedback state of the number box. */
export type DocNumberInputState = 'idle' | 'checking' | 'ok' | 'bad';

export interface DocNumberInputViewProps {
  label?: string;
  /** Renders the ★ marker every document number carries. */
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  /** Fired on blur — the live field uses it to zero-pad a short number. */
  onBlur?: () => void;
  state?: DocNumberInputState;
  /** Error text shown when `state` is 'bad'. */
  message?: string;
  /** Edit mode — the code is immutable; nothing is prefilled or checked. */
  readOnly?: boolean;
  placeholder?: string;
  /** id of the box, for the label. Defaults to a useId()-unique one, so many
   *  of these can sit on one page (the kit renders five). */
  id?: string;
  /** Width on the 12-column grid. Default 'sm' (doc numbers). */
  size?: DocNumberInputSize;
}

/** Presentational document-number field. No hook, no fetch — hand it a `state`. */
export function DocNumberInputView({
  label = 'Doc No.',
  required = false,
  value = '',
  onChange,
  onBlur,
  state = 'idle',
  message,
  readOnly = false,
  placeholder,
  id,
  size = 'sm',
}: DocNumberInputViewProps): React.JSX.Element {
  // The kit page renders five of these side by side; a fixed id would give
  // them one DOM id between them and point every label at the first box.
  const uid = useId();
  const inputId = id ?? `docno-${uid}`;
  // The status glyph means something only while the user can still change the
  // number AND has typed something — §D.2.
  const showStatus = !readOnly && value.trim().length > 0;
  const isError = showStatus && state === 'bad';

  return (
    <FormField
      label={label}
      required={required}
      size={size}
      htmlFor={inputId}
      error={isError ? (message ?? 'Duplicate — this number already exists') : undefined}
      help={isError ? undefined : hintFor(readOnly, state, value.trim() === '')}
    >
      <div style={{ position: 'relative' }}>
        <Input
          id={inputId}
          state={showStatus && (state === 'ok' || state === 'bad') ? state : undefined}
          autoComplete="off"
          readOnly={readOnly}
          placeholder={readOnly ? undefined : placeholder}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => onBlur?.()}
          // Room for the status glyph. --sp-6 is the 32px step.
          style={{ paddingRight: 'var(--sp-6)' }}
        />
        {showStatus ? (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 'var(--sp-2)',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'inline-flex',
            }}
          >
            {/* Checking is the reference's plain "…" glyph
                (design-ref/components/forms/DocNumberInput.jsx:4) — there is no
                spin keyframe in innovic-theme.css and a Tailwind utility has no
                business inside ui/. ✓ / ✕ come from ui/core/Icon, the one
                control-icon source. */}
            {state === 'checking' ? (
              <span
                style={{
                  color: 'var(--text3)',
                  fontWeight: 700,
                  fontSize: 'var(--fs-sm)',
                  lineHeight: 1,
                }}
              >
                …
              </span>
            ) : state === 'bad' ? (
              <Icon name="x" size={14} color="var(--red)" />
            ) : state === 'ok' ? (
              <Icon name="check" size={14} color="var(--green)" />
            ) : null}
          </span>
        ) : null}
      </div>
    </FormField>
  );
}

/** The one line under the box. Wording is fixed by §D.2 — do not paraphrase. */
function hintFor(readOnly: boolean, state: DocNumberInputState, empty: boolean): React.ReactNode {
  if (readOnly) return 'Code cannot be changed after creation.';
  if (state === 'checking') return 'Checking…';
  if (state === 'ok' && !empty) return <span style={{ color: 'var(--green)' }}>✓ Available</span>;
  // Idle with something typed falls through to the auto-fill line, exactly as
  // the reference and the live field do. Returning nothing here would drop the
  // line out of the layout and make the field jump height as you type.
  return 'Auto-filled with the next number. Edit to use your own — leave blank to auto-generate on save.';
}

// The live, hook-backed field. Re-exported, not reimplemented.
export { DocNumberInput } from '@/components/shared/doc-number-input';
export type { DocNumberInputProps } from '@/components/shared/doc-number-input';
