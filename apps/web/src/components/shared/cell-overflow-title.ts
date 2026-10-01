// Table standard (ADR-199): a body cell is one line and long text ends in an
// ellipsis. This gives a cut cell its full text as a hover tooltip, for every
// `.innovic-table` in the app, without each page adding `title` by hand.
//
// ONE delegated, passive `mouseover` listener on the document. On hover over a
// data cell (not a full-width colSpan cell) that has no title of its own:
//   - text is cut (scrollWidth > clientWidth) -> set `title` to its text;
//   - text fits again (e.g. after a resize)   -> remove a title WE set.
// A title the page wrote itself is never touched.

const MARK = 'data-auto-title';

function onMouseOver(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const td = target.closest('td');
  if (!td || td.hasAttribute('colspan') || !td.closest('.innovic-table')) return;
  // A cell holding controls is allowed to spill over, and its text would be
  // every <option> / button label run together — never a useful tooltip.
  if (td.querySelector('input, select, textarea, button')) return;

  const ours = td.hasAttribute(MARK);
  if (td.hasAttribute('title') && !ours) return;

  if (td.scrollWidth > td.clientWidth) {
    const text = (td.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) {
      td.setAttribute('title', text);
      td.setAttribute(MARK, '');
      return;
    }
  }
  if (ours) {
    td.removeAttribute('title');
    td.removeAttribute(MARK);
  }
}

/** Installs the listener; returns the function that removes it. */
export function installCellOverflowTitles(): () => void {
  document.addEventListener('mouseover', onMouseOver, { passive: true });
  return () => document.removeEventListener('mouseover', onMouseOver);
}
