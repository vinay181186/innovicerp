// "No Drawing Rev" warning (ADR-289, point 13) — shown where a Job Card / PRO
// names a MAKE item that has no Drawing Rev. Warning only: nothing is blocked.
// The server decides (`drawingRevMissing: true` on the response); this only
// says so and points at the Drawing Rev Fix List where it is put right.

import { Link } from '@tanstack/react-router';
import { Banner } from '@/ui/feedback';

/** Reads the server's `drawingRevMissing` flag off a response object. */
export function drawingRevMissing(doc: object | null | undefined): boolean {
  return Boolean(doc && 'drawingRevMissing' in doc && doc.drawingRevMissing === true);
}

export function DrawingRevMissingNote(): React.JSX.Element {
  return (
    <Banner tone="warn" role="status" flush>
      <span>
        No Drawing Rev — set it from the{' '}
        <Link to="/drawing-rev-fix-list">Drawing Rev Fix List</Link>
      </span>
    </Banner>
  );
}
