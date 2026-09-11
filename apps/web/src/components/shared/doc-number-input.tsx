// Reusable document-number field with live duplicate/format feedback.
//
// Controlled component (value/onChange) so it drops into the existing useForm
// forms without a FormProvider — the parent binds it to its react-hook-form
// `code` field via watch()/setValue(). On create it prefills the suggested next
// number (editable); as the user types it debounce-checks the backend and shows
// ✓ available / ✗ duplicate / format error; on blur it zero-pads a short value.
// The parent disables Save via onValidityChange. Phase 2 reuses this verbatim.

import { type DocNumberType, DOC_NUMBER_FORMATS, poCodePrefix, type PoType } from '@innovic/shared';
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
  /** PURCHASE ORDERS ONLY — the type currently chosen in the form. It picks the
   *  series (IN-MPO- / IN-JWPO- / IN-SPO- / IN-OPO-) the suggestion and the
   *  placeholder are built from. */
  poType?: PoType;
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
  poType,
}: DocNumberInputProps): React.JSX.Element {
  const fmt = DOC_NUMBER_FORMATS[type];
  const state = useDocNumber(type, readOnly ? '' : value, poType);
  // A PO's prefix is the one its TYPE is numbered with; every other document
  // has the single prefix its format declares.
  const prefix = type === 'purchase_order' && poType ? poCodePrefix(poType) : fmt.prefix;

  // Prefill the suggested next code once, only on create and only while empty.
  //
  // The series can change under us: on a PO, switching the type dropdown asks
  // the backend again and comes back with a DIFFERENT prefix. When the box is
  // still holding the number WE put there, it is replaced, so the suggestion
  // always matches the dropdown. A number the user typed is never touched —
  // `autoFilled` stops matching the moment they edit it. `filledFor` tracks the
  // series we last filled for, so on a non-PO form (series never changes) this
  // behaves exactly as it always did: fill once, while empty.
  const seriesKey = poType ?? '';
  const filledFor = useRef<string | null>(null);
  const autoFilled = useRef('');
  useEffect(() => {
    if (readOnly) return;
    const next = state.nextCode;
    if (!next) return;
    const current = value.trim();
    const firstFill = filledFor.current === null && current === '';
    const seriesChanged =
      filledFor.current !== null &&
      filledFor.current !== seriesKey &&
      (current === '' || current === autoFilled.current);
    if (!firstFill && !seriesChanged) return;
    filledFor.current = seriesKey;
    autoFilled.current = next;
    if (current !== next) onChange(next);
  }, [readOnly, state.nextCode, value, onChange, seriesKey]);

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
          placeholder={readOnly ? undefined : `${prefix}${'0'.repeat(fmt.digits)}`}
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
