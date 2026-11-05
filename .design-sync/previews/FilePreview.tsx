import { FilePreview } from '@innovic/web';

// An invented drawing, inlined so the card needs no storage URL.
const drawing =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><rect width="360" height="200" fill="#fff"/><g fill="none" stroke="#1f2d3d" stroke-width="2"><path d="M60 40h240v50H170v70H60z"/><circle cx="100" cy="125" r="14"/><circle cx="250" cy="65" r="10"/></g><text x="180" y="185" font-family="monospace" font-size="12" fill="#1f2d3d">BRKT-101/A Rev B</text></svg>',
  );

const noop = () => {};

export const ImageDrawing = () => (
  <FilePreview inline kind="image" fileName="BRKT-101-A Rev B.png" src={drawing} onDownload={noop} onClose={noop} />
);

export const ViewOnlyDrawing = () => (
  <FilePreview inline kind="image" fileName="BRKT-101-A Rev B.png" src={drawing} canDownload={false} onClose={noop} />
);

export const Loading = () => (
  <FilePreview inline kind="pdf" fileName="IN-MPO-00311 PO.pdf" onDownload={noop} onClose={noop} />
);

export const CannotPreview = () => (
  <FilePreview inline kind="none" fileName="Inspection plan.xlsx" onDownload={noop} onClose={noop} />
);

export const LinkExpired = () => (
  <FilePreview
    inline
    kind="pdf"
    fileName="QC Report IN-JC-00456.pdf"
    canDownload={false}
    errorText="This link has expired. Close the preview and open the file again."
    onClose={noop}
  />
);
