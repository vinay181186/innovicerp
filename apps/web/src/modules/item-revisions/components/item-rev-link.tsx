// "ABC/1" as a link to its drawing page — the one way a screen points at an
// Item + Drawing Rev. Without a register id (old line, Buy item) it is plain
// text, so a row never offers a page that does not exist.

import { Link } from '@tanstack/react-router';

export function ItemRevLink({
  itemRevisionId,
  label,
  className = 'mono fw-700',
}: {
  itemRevisionId: string | null | undefined;
  /** itemRevLabel(code, rev) — "ABC/1". */
  label: string;
  className?: string;
}): React.JSX.Element {
  if (!itemRevisionId) return <span className={className}>{label}</span>;
  return (
    <Link
      to="/drawings/$itemRevisionId"
      params={{ itemRevisionId }}
      className={className}
      title={`Open the drawing of ${label}`}
      // A row click must not also fire.
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}

/** "Not uploaded", or a link that opens the drawing page. */
export function DrawingStatusLink({
  itemRevisionId,
  drawingFilePath,
}: {
  itemRevisionId: string | null | undefined;
  drawingFilePath: string | null | undefined;
}): React.JSX.Element {
  if (!drawingFilePath) return <span className="text3">Not uploaded</span>;
  if (!itemRevisionId) return <span>📎 on file</span>;
  return (
    <Link
      to="/drawings/$itemRevisionId"
      params={{ itemRevisionId }}
      title="Open the drawing page"
      onClick={(e) => e.stopPropagation()}
    >
      📎 View drawing
    </Link>
  );
}
