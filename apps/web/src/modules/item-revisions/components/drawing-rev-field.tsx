// DrawingRevField — the drawing control for anything that names an Item +
// Drawing Rev: the Route Card form and the SO / JWSO line cells.
//
// "ABC/1" is ONE register record holding one drawing (owner model 2026-10-31).
// As soon as the item and a valid Rev are both filled this looks ABC/<rev> up:
//
//   exists, has a file  → that file is shown read-only (📎 view) and written
//                         into the form, so the save carries the same path the
//                         server holds. A wrong file is fixed only through
//                         "Replace drawing…" (Route Card Master Edit holders).
//   exists, no file     → upload box; the uploaded file is adopted by ABC/<rev>.
//   does not exist      → upload box; saving creates ABC/<rev>.
//   Rev changed on a saved line and the new ABC/<rev> does not exist
//                       → two choices: "Use as is" (carry the old drawing to
//                         the new Rev) or "Upload new".
//   Buy item / RM (revRequired false), or no valid Rev yet
//                       → the plain upload box the line always had.
//
// The server enforces every one of these rules; this only stops the user from
// building a save the server will refuse ("Drawing differs from ABC/1 …").

import type { DrawingSource, ItemRevision } from '@innovic/shared';
import { itemRevLabel } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';
import { cleanDrawingRev, useItemRevisionLookup } from '../api';
import { ITEM_REVISION_DRAWING_FOLDER, ReplaceDrawingDialog } from './replace-drawing-dialog';

export interface DrawingRevFieldProps {
  itemId: string | null | undefined;
  /** Shown in "ABC/1" while the record does not exist yet. */
  itemCode: string | null | undefined;
  /** The Drawing Rev as typed on the form. */
  rev: string | null | undefined;
  /** The form's current drawing file path. */
  value: string | null | undefined;
  onChange: (path: string | null) => void;
  /** Access-log source for a file not yet in the register (the line's own). */
  source: DrawingSource;
  /** Access-log reference ("IN-SO-26-00521 L3"). */
  refCode?: string | undefined;
  /** Saved line only: the Rev and file the line was LOADED with — drives the
   *  "Use as is / Upload new" choice when the Rev is changed. */
  savedRev?: string | null | undefined;
  savedPath?: string | null | undefined;
}

export function DrawingRevField(props: DrawingRevFieldProps): React.JSX.Element {
  const { itemId, itemCode, rev, value, onChange, source, refCode, savedRev, savedPath } = props;
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const canReplace = effectiveFormPerms(eff, 'routecard_create').edit;
  const lookup = useItemRevisionLookup(itemId, rev);
  const cleaned = cleanDrawingRev(rev);
  const active = Boolean(itemId && cleaned);
  const data = active ? lookup.data : undefined;
  const revision: ItemRevision | null = data?.revision ?? null;
  const registerFile = revision?.drawingFilePath ?? null;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; src: DrawingSource; ref?: string } | null>(
    null,
  );
  const [replacing, setReplacing] = useState(false);
  // The path THIS control wrote from the register, so a later Rev with no file
  // clears it again instead of quietly carrying ABC/1's drawing to ABC/2.
  const autoFilled = useRef<string | null>(null);
  // "Use as is" / "Upload new" on a Rev change.
  const [revChoice, setRevChoice] = useState<'keep' | 'new' | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!data) return;
    if (registerFile) {
      if (value !== registerFile) {
        autoFilled.current = registerFile;
        onChangeRef.current(registerFile);
      }
      return;
    }
    // No file in the register for this Item + Rev: drop a drawing this control
    // filled in for a DIFFERENT Rev (dependent field sync).
    if (autoFilled.current && value === autoFilled.current) {
      autoFilled.current = null;
      onChangeRef.current(null);
    }
  }, [data, registerFile, value]);

  // A new Rev typed → ask the keep/new question again.
  useEffect(() => {
    setRevChoice(null);
  }, [cleaned]);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    if (!me?.companyId) {
      setErr('No company on session');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      onChange(await uploadFile(file, me.companyId, { folder: ITEM_REVISION_DRAWING_FOLDER }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const label = revision?.label ?? itemRevLabel(itemCode, cleaned);
  const revRequired = data?.revRequired ?? true;
  const inRegister = active && revRequired;
  const checking = active && lookup.isFetching && !lookup.data;

  const uploadBox = (
    <input
      type="file"
      className="innovic-input"
      accept="image/*,.pdf"
      aria-label="Drawing file"
      onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
    />
  );

  const viewButtons = (path: string, fromRegister: boolean): React.JSX.Element => (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        title="Preview drawing"
        onClick={() =>
          setPreview(
            fromRegister
              ? { path, src: 'item_revision', ref: label }
              : { path, src: source, ...(refCode ? { ref: refCode } : {}) },
          )
        }
      >
        📎 view
      </button>
      {fromRegister ? null : (
        <button
          type="button"
          className="btn btn-ghost btn-sm red"
          title="Clear drawing"
          aria-label="Clear drawing"
          onClick={() => {
            autoFilled.current = null;
            onChange(null);
          }}
        >
          ✕
        </button>
      )}
    </span>
  );

  // Rev changed on a saved line, the new Item + Rev does not exist, and the
  // line still holds the old drawing → ask what to do with it.
  const savedClean = cleanDrawingRev(savedRev);
  const revChanged =
    inRegister && Boolean(savedClean) && savedClean !== cleaned && !revision && Boolean(savedPath);

  let body: React.ReactNode;
  let note: React.ReactNode = null;
  if (busy) {
    body = (
      <span className="text3">
        <Loader2 size={12} className="inline animate-spin" /> uploading…
      </span>
    );
  } else if (checking) {
    body = (
      <span className="text3">
        <Loader2 size={12} className="inline animate-spin" /> checking {label}…
      </span>
    );
  } else if (inRegister && registerFile) {
    body = (
      <>
        {viewButtons(registerFile, true)}
        {canReplace && revision ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplacing(true)}>
            Replace drawing…
          </button>
        ) : null}
      </>
    );
    note = (
      <>
        <b className="mono">{label}</b>
        {revision?.sourceRef ? ` · drawing from ${revision.sourceRef}` : ' · drawing on file'}
      </>
    );
  } else if (revChanged && revChoice !== 'new') {
    body = (
      <>
        <button
          type="button"
          className={`btn btn-sm ${revChoice === 'keep' ? 'btn-primary' : 'btn-ghost'}`}
          title={`Carry the drawing of ${itemRevLabel(itemCode, savedClean)} to ${label}`}
          onClick={() => {
            setRevChoice('keep');
            onChange(savedPath ?? null);
          }}
        >
          Use as is
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setRevChoice('new');
            onChange(null);
          }}
        >
          Upload new
        </button>
        {value ? viewButtons(value, false) : null}
      </>
    );
    note = (
      <>
        new — <b className="mono">{label}</b> will be created
      </>
    );
  } else {
    body = value ? viewButtons(value, false) : uploadBox;
    if (inRegister && data) {
      note = revision ? (
        <>
          <b className="mono">{label}</b> has no drawing yet — the file uploaded here becomes its
          drawing
        </>
      ) : (
        <>
          new — <b className="mono">{label}</b> will be created
        </>
      );
    } else if (active && lookup.isError) {
      note = <span className="red">Could not check {label}</span>;
    }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-1)',
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {body}
      </div>
      {note ? (
        <div
          className="text3"
          style={{
            fontSize: 'var(--fs-xs)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={typeof note === 'string' ? note : undefined}
        >
          {note}
        </div>
      ) : null}
      {err ? <div className="form-error">{err}</div> : null}
      {preview ? (
        <FilePreviewModal
          storagePath={preview.path}
          kind="drawing"
          source={preview.src}
          {...(preview.ref ? { refCode: preview.ref } : {})}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {replacing && revision ? (
        <ReplaceDrawingDialog
          revision={revision}
          onCancel={() => setReplacing(false)}
          onDone={(path) => {
            setReplacing(false);
            autoFilled.current = path;
            onChange(path);
          }}
        />
      ) : null}
    </div>
  );
}
