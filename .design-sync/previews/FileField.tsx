import { FileField, FormGrid } from '@innovic/web';

const noop = () => {};

export const AttachChip = () => <FileField onPick={noop} />;

export const AttachAttached = () => (
  <FileField fileName="QC Report IN-JC-00456.pdf" onPick={noop} onRemove={noop} />
);

export const AttachError = () => <FileField onPick={noop} error="This file is over the 50 MB limit." />;

export const Drawing = () => (
  <FormGrid>
    <FileField variant="drawing" fileName="BRKT-101-A Rev B.pdf" onPick={noop} onRemove={noop} onView={noop} />
  </FormGrid>
);

export const DrawingUploading = () => (
  <FormGrid>
    <FileField variant="drawing" busy onPick={noop} />
  </FormGrid>
);

export const ProductImage = () => (
  <FormGrid>
    <FileField variant="image" onPick={noop} />
  </FormGrid>
);
