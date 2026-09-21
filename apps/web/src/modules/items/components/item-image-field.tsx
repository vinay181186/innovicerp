// Product-image field for the item form (user decision 2026-09-21). Same shape
// as drawing-upload-field.tsx, for a picture instead of a drawing: the chosen
// JPG/PNG/WebP is shrunk in the browser (longest edge ≤ ITEM_IMAGE_MAX_EDGE),
// uploaded to the private bucket under `item-images/`, and the resulting path
// reported back to the form's `imagePath`. Remove sets it to null, which the
// API reads as "clear the image".
//
// Preview is the 96 px ItemImageBox — the same box the Item page header uses —
// so what you see here is what every list will show. Self-contained: reads
// companyId from the session.

import { ITEM_IMAGE_MIME_TYPES } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ItemImageBox } from '@/components/shared/item-badge';
import { uploadItemImage } from '@/lib/item-image';
import { useSession } from '@/lib/session';

export function ItemImageField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (path: string | null) => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    if (!me?.companyId) {
      setErr('No company on the current session.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const path = await uploadItemImage(file, me.companyId);
      onChange(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="form-grp form-full">
      <label className="form-label">
        Product image <span className="form-help">(3D render — JPG, PNG or WebP, up to 5 MB)</span>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ItemImageBox imagePath={value} size="page" alt="Product image" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 size={12} className="inline animate-spin" /> : null}{' '}
              {busy ? 'Uploading…' : value ? 'Change image' : 'Choose image'}
            </button>
            {value && !busy ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setErr(null);
                  onChange(null);
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
          <div className="form-help">
            {value
              ? 'Shown as a small thumbnail beside the item code on every list. Click it to see it large.'
              : 'Optional. Resized in the browser before upload, so any photo or render works.'}
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ITEM_IMAGE_MIME_TYPES.join(',')}
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
      />
      {err ? <div className="form-error">{err}</div> : null}
    </div>
  );
}
