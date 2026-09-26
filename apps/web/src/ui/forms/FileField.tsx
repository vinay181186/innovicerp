// FileField — the one upload control, in the three shapes the product actually
// renders. It is the consolidation target for three separate files (see
// audit/02-element-inventory.md §A, forms/FileField):
//
//   variant="attach"   ← components/shared/qc-report-attach.tsx (QcReportAttach)
//                        the "📎 Attach QC Report (optional)" chip
//   variant="drawing"  ← modules/items/components/drawing-upload-field.tsx
//                        native file input + 📎 preview / Remove buttons
//   variant="image"    ← modules/items/components/item-image-field.tsx
//                        96 px preview box + Choose / Change / Remove
//
// PHASE 2 SCOPE: PRESENTATIONAL ONLY. Those three files are untouched and
// still in use. Everything they own that is not markup — the companyId check,
// `uploadFile` / `uploadItemImage`, the 10 MB and 5 MB limits, the in-browser
// resize, the busy/error state, and opening the file through
// `FilePreviewModal` — stays with the caller and arrives here as `busy` /
// `error` / `fileName` / `onPick` / `onRemove` / `onView`. That is what makes
// this renderable in every state with no fetch.
//
// Two rules carried over from the originals:
//   • Viewing a file ALWAYS goes through the in-app preview (`onView`), never
//     window.open — that skipped the drawing-download access check and let the
//     browser silently save the file instead of showing it.
//   • The picker re-fires for the same file: a HIDDEN input's value is cleared
//     on every pick, so re-choosing a just-removed file still works. The
//     `drawing` variant's input is the visible control and is never cleared —
//     doing so wipes the file name the user just chose.
//
// PHASE 4: rewire those three files onto this component. The `image` variant
// takes its thumbnail through the `preview` slot precisely so the items module
// can inject <ItemImageBox> without ui/ having to know about it.

import { useId, useRef } from 'react';
import { FormField, type FormFieldSize } from './FormField';
import { Input } from './Input';

export type FileFieldVariant = 'attach' | 'drawing' | 'image';

/** Width on the 12-column FormGrid (drawing / image variants). */
export type FileFieldSize = FormFieldSize;

export interface FileFieldProps {
  variant?: FileFieldVariant | undefined;
  label?: string | undefined;
  /** Name of the attached file, or null when nothing is attached. */
  fileName?: string | null | undefined;
  /** True while the caller is uploading. */
  busy?: boolean | undefined;
  /** Upload or validation message, rendered in red. */
  error?: string | undefined;
  /** Replaces the default hint line under the control. */
  help?: string | undefined;
  /** Picker filter. Defaults per variant: `image` → image/*, else image/*,.pdf. */
  accept?: string | undefined;
  /** Blocks picking entirely — e.g. no company on the session. */
  disabled?: boolean | undefined;
  /** Called with the chosen File. The caller does the upload. */
  onPick?: ((file: File) => void) | undefined;
  /** Called when the user clears the attachment. */
  onRemove?: (() => void) | undefined;
  /** Called to open the file in the in-app preview. */
  onView?: (() => void) | undefined;
  /** `image` variant only — the thumbnail node, e.g. <ItemImageBox>. A plain
   *  placeholder box is drawn when it is omitted. */
  preview?: React.ReactNode | undefined;
  /** Width on the 12-column grid. Default 'full'. Ignored by `attach`. */
  size?: FileFieldSize | undefined;
  id?: string | undefined;
}

// The image field's own hint says "JPG, PNG or WebP" — so the picker must not
// offer a PDF by default. (design-ref/components/forms/FileField.jsx uses one
// accept for all three variants; that is the sloppiness, not the spec.)
const DEFAULT_ACCEPT: Record<FileFieldVariant, string> = {
  attach: 'image/*,.pdf',
  drawing: 'image/*,.pdf',
  image: 'image/*',
};

export function FileField({
  variant = 'attach',
  label,
  fileName,
  busy = false,
  error,
  help,
  accept,
  disabled = false,
  onPick,
  onRemove,
  onView,
  preview,
  size = 'full',
  id,
}: FileFieldProps): React.JSX.Element {
  const uid = useId();
  const inputId = id ?? `${uid}-file`;
  const blocked = disabled || busy;
  const attached = fileName ?? null;
  const accepted = accept ?? DEFAULT_ACCEPT[variant];
  // The image variant's <input> is hidden, so its button clicks it directly.
  const hiddenInput = useRef<HTMLInputElement>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    // Only for the HIDDEN inputs: clearing lets the user re-pick a file they
    // just removed. The `drawing` variant's input is the visible control, and
    // clearing it snaps the caption back to "No file chosen" the instant a
    // pick succeeds — which is why neither the reference nor the live
    // drawing-upload-field does it there.
    if (variant !== 'drawing') e.target.value = '';
    if (file && onPick) onPick(file);
  }

  if (variant === 'attach') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <label
          htmlFor={inputId}
          style={{
            cursor: blocked ? 'not-allowed' : 'pointer',
            padding: 'var(--sp-1) var(--sp-3)',
            background: 'var(--bg4)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-xs)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          📎 {busy ? 'Uploading…' : (attached ?? label ?? 'Attach QC Report (optional)')}
        </label>
        <input
          id={inputId}
          type="file"
          accept={accepted}
          style={{ display: 'none' }}
          disabled={blocked}
          onChange={handlePick}
        />
        {attached ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 'var(--fs-xs)' }}
            onClick={onRemove}
          >
            × Remove
          </button>
        ) : null}
        {error ? (
          <span style={{ color: 'var(--red2)', fontSize: 'var(--fs-xs)' }}>{error}</span>
        ) : null}
      </div>
    );
  }

  const isImage = variant === 'image';
  const hint =
    help ??
    (isImage
      ? attached
        ? 'Shown as a small thumbnail beside the item code on every list. Click it to see it large.'
        : 'Optional. Resized in the browser before upload, so any photo or render works.'
      : 'Stored privately; opened via a short-lived link.');

  return (
    <FormField
      label={
        <>
          {label ?? (isImage ? 'Product image' : 'Drawing File')}{' '}
          <span className="form-help" style={{ textTransform: 'none' }}>
            {isImage ? '(3D render — JPG, PNG or WebP, up to 5 MB)' : '(Image/PDF)'}
          </span>
        </>
      }
      size={size}
      // Only the `drawing` variant's control IS the <input>. On `image` the
      // input is hidden behind a button, and a title label pointing at it
      // would open the OS file dialog when the user clicks the words
      // "Product image" — the reference's title label carries no htmlFor.
      htmlFor={isImage ? undefined : inputId}
      error={error ?? undefined}
    >
      {isImage ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}
        >
          {preview ?? <ImagePlaceholder />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
              {/* A real <button>, not a <label for>: a label is not
                  keyboard-focusable and never takes :disabled, so the control
                  could be neither tabbed to nor shown as busy. Reference:
                  design-ref/components/forms/FileField.jsx:22. */}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={blocked}
                onClick={() => hiddenInput.current?.click()}
              >
                {busy ? 'Uploading…' : attached ? 'Change image' : 'Choose image'}
              </button>
              {attached && !busy ? (
                <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
                  Remove
                </button>
              ) : null}
            </div>
            <div className="form-help">{hint}</div>
          </div>
          <input
            ref={hiddenInput}
            id={inputId}
            type="file"
            accept={accepted}
            style={{ display: 'none' }}
            disabled={blocked}
            onChange={handlePick}
          />
        </div>
      ) : (
        <>
          <Input
            id={inputId}
            type="file"
            accept={accepted}
            disabled={blocked}
            onChange={handlePick}
          />
          {busy ? (
            <div className="form-help">Uploading…</div>
          ) : attached ? (
            <div
              className="form-help"
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
            >
              <button type="button" className="btn btn-ghost btn-sm" onClick={onView}>
                📎 {attached}
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
                Remove
              </button>
            </div>
          ) : (
            <div className="form-help">{hint}</div>
          )}
        </>
      )}
    </FormField>
  );
}

/** Stand-in for the real thumbnail, so the field renders with no data. */
function ImagePlaceholder(): React.JSX.Element {
  // 96 px — the `page` ItemImageBox size, expressed off the spacing scale so
  // no raw pixel value lands in the component.
  const side = 'calc(var(--sp-6) * 3)';
  return (
    <div
      aria-hidden
      style={{
        width: side,
        height: side,
        flexShrink: 0,
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--bg4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text3)',
        fontSize: 'var(--fs-xl)',
      }}
    >
      ▣
    </div>
  );
}
