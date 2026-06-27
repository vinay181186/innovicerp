// Reusable document-number field with live duplicate/format feedback.
//
// Controlled component (value/onChange) so it drops into the existing useForm
// forms without a FormProvider — the parent binds it to its react-hook-form
// `code` field via watch()/setValue(). On create it prefills the suggested next
// number (editable); as the user types it debounce-checks the backend and shows
// ✓ available / ✗ duplicate / format error; on blur it zero-pads a short value.
// The parent disables Save via onValidityChange. Phase 2 reuses this verbatim.

import { type DocNumberType, DOC_NUMBER_FORMATS } from '@innovic/shared';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useDocNumber } from '@/lib/use-doc-number';

export interface DocNumberInputProps {
  type: DocNumberType;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  /** Edit mode — show the value read-only, no prefill/checks (code is immutable). */
  readOnly?: boolean;
  id?: string;
  /** Notified whenever the save-eligibility of the field changes. */
  onValidityChange?: (valid: boolean) => void;
}

export function DocNumberInput({
  type,
  value,
  onChange,
  label,
  required,
  readOnly,
  id,
  onValidityChange,
}: DocNumberInputProps): React.JSX.Element {
  const fmt = DOC_NUMBER_FORMATS[type];
  const state = useDocNumber(type, readOnly ? '' : value);

  // Prefill the suggested next code once, only on create and only while empty.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!readOnly && !prefilled.current && state.nextCode && value.trim() === '') {
      onChange(state.nextCode);
      prefilled.current = true;
    }
  }, [readOnly, state.nextCode, value, onChange]);

  // Edit mode is always "valid" (immutable existing code); create defers to the hook.
  const effectiveValid = readOnly ? true : state.valid;
  useEffect(() => {
    onValidityChange?.(effectiveValid);
  }, [effectiveValid, onValidityChange]);

  const showStatus = !readOnly && value.trim().length > 0;

  return (
    <div className="form-grp">
      <label className="form-label" htmlFor={id ?? `docno-${type}`}>
        {label ?? fmt.label}
        {required ? <span className="req">★</span> : null}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id ?? `docno-${type}`}
          className="innovic-input"
          autoComplete="off"
          readOnly={readOnly}
          placeholder={readOnly ? undefined : `${fmt.prefix}${'0'.repeat(fmt.digits)}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (!readOnly && value.trim()) onChange(state.padded);
          }}
          style={
            showStatus && state.error
              ? { borderColor: 'var(--red)', paddingRight: 30 }
              : showStatus && state.valid
                ? { borderColor: 'var(--green)', paddingRight: 30 }
                : { paddingRight: 30 }
          }
        />
        {showStatus ? (
          <span
            aria-hidden
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex' }}
          >
            {state.checking ? (
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text3)' }} />
            ) : state.error ? (
              <X size={15} style={{ color: 'var(--red)' }} />
            ) : (
              <Check size={15} style={{ color: 'var(--green)' }} />
            )}
          </span>
        ) : null}
      </div>
      {readOnly ? (
        <div className="form-help">Code cannot be changed after creation.</div>
      ) : state.checking ? (
        <div className="form-help">Checking…</div>
      ) : state.error ? (
        <div className="form-error">{state.error}</div>
      ) : value.trim() === '' ? (
        <div className="form-help">
          Auto-filled with the next number. Edit to use your own — leave blank to auto-generate on save.
        </div>
      ) : (
        <div className="form-help" style={{ color: 'var(--green)' }}>✓ Available</div>
      )}
    </div>
  );
}
