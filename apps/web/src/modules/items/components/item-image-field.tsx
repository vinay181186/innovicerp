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
//
// PHASE 4: the MARKUP is now ui/forms/FileField `variant="image"` (the
// consolidation target named in that file's own header). Everything that is
// not markup stays here, exactly as it was — the companyId check,
// `uploadItemImage`, the in-browser resize, the busy/error state and the
// null-on-remove contract. FileField draws; this component still decides.

import { ITEM_IMAGE_MIME_TYPES } from '@innovic/shared';
import { useState } from 'react';
import { ItemImageBox } from '@/components/shared/item-badge';
import { FileField } from '@/ui/forms';
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

  async function onPick(file: File): Promise<void> {
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
    }
  }

  return (
    <FileField
      variant="image"
      label="Product image"
      size="full"
      fileName={value ?? null}
      busy={busy}
      error={err ?? undefined}
      accept={ITEM_IMAGE_MIME_TYPES.join(',')}
      preview={<ItemImageBox imagePath={value} size="page" alt="Product image" />}
      onPick={(file) => void onPick(file)}
      onRemove={() => {
        setErr(null);
        onChange(null);
      }}
    />
  );
}
