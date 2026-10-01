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
/** The fit table's ▸ row toggle (ui/data/FitDataTable) — a control, but not
 *  one that makes the cell's text meaningless as a tooltip. */
const TOGGLE = '.dt-exp';
const CONTROLS = 'input, select, textarea, button';

/** Is the cell's text cut — on the cell itself, or on an inner element that
 *  does its own ellipsis (a fit-table `.dt-cell`, a badge's name span…)? */
function isCut(td: HTMLElement): boolean {
  if (td.scrollWidth > td.clientWidth) return true;
  const inner = td.querySelectorAll<HTMLElement>('.dt-cell, span, div');
  for (let i = 0; i < inner.length && i < 20; i += 1) {
    const el = inner[i];
    if (el && el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')
      return true;
  }
  return false;
}

/** The cell's text without the ▸ toggle's glyph. */
function cellText(td: HTMLElement): string {
  let text = '';
  td.childNodes.forEach((n) => {
    if (n instanceof Element && n.matches(TOGGLE)) return;
    text += n.textContent ?? '';
  });
  return text.replace(/\s+/g, ' ').trim();
}

function onMouseOver(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const td = target.closest('td');
  if (!td || td.hasAttribute('colspan') || !td.closest('.innovic-table')) return;
  // A cell holding controls is allowed to spill over, and its text would be
  // every <option> / button label run together — never a useful tooltip. The
  // fit table's ▸ toggle does not count: column 0 still gets its tooltip.
  const controls = td.querySelectorAll(CONTROLS);
  for (const c of controls) if (!c.matches(TOGGLE)) return;

  const ours = td.hasAttribute(MARK);
  if (td.hasAttribute('title') && !ours) return;

  if (isCut(td)) {
    const text = cellText(td);
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
