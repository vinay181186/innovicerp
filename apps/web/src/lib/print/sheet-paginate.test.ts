// @vitest-environment jsdom
// The sheet's paginator, run for real on stubbed row heights. A document WITHOUT
// the ADR-278 attributes (PO, DC, GRN, JC) must split exactly as it always has.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetDocumentHtml } from './sheet-print';

const MM = 96 / 25.4;
const PAGE_H = 297 * MM;
const FOOT_H = 9 * MM;
const FOOT_RESERVE = 8 * MM;
const HEAD = 100;

/** A row of height `h` px, with its data-* attributes and a label. */
function row(label: string, h: number, attrs = ''): string {
  return `<tr data-h="${h}" ${attrs}><td>${label}</td></tr>`;
}

function paginate(rows: string, articleAttrs = '', colgroup = ''): void {
  document.body.innerHTML = `<article class="sheet" ${articleAttrs}><table class="doc">${colgroup}
    <thead data-h="${HEAD}"><tr><th>head</th></tr></thead>
    <tfoot><tr><td>foot</td></tr></tfoot>
    <tbody>${rows}</tbody></table></article>`;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return { height: Number(this.getAttribute('data-h') ?? 0) } as DOMRect;
  });
  const html = sheetDocumentHtml('t', '');
  const script = /<script>([^]*)<\/script>/.exec(html)?.[1] ?? '';
  expect(script).toContain('function run()');
  // jsdom has finished loading, so the paginator runs at once.
  new Function(script)();
}

const pages = (): string[][] =>
  [...document.querySelectorAll('.page')].map((p) =>
    [...p.querySelectorAll('tbody tr')].map((r) => r.textContent ?? ''),
  );

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('paginator, document without the new attributes', () => {
  const avail = PAGE_H - HEAD - FOOT_H;

  it('fills each page by height, keeps every row and adds no foot', () => {
    const h = Math.floor(avail / 3);
    paginate(row('a', h) + row('b', h) + row('c', h) + row('d', h) + row('e', h));
    expect(pages()).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    expect(document.querySelector('.page-foot')).toBeNull();
    expect(document.querySelector('colgroup')).toBeNull();
  });

  it('breaks at the same row at the exact limit and one pixel over it', () => {
    paginate(row('a', avail) + row('b', 1));
    expect(pages()).toEqual([['a'], ['b']]);
    paginate(row('a', avail - 1) + row('b', 1));
    expect(pages()).toEqual([['a', 'b']]);
  });

  it('carries the Job Card heading: one copy, no contd., on the page that starts with the row', () => {
    const h = Math.floor(avail / 2);
    paginate(
      row('ops head', 20, 'data-head-for="ops"') +
        row('a', h, 'data-carry-head="ops"') +
        row('b', h, 'data-carry-head="ops"') +
        row('c', h, 'data-carry-head="ops"'),
    );
    expect(pages()).toEqual([
      ['ops head', 'a'],
      ['ops head', 'b'],
      ['ops head', 'c'],
    ]);
  });

  it('still fills the page-count slots', () => {
    const h = Math.floor(avail / 2);
    document.body.innerHTML = '';
    paginate(row('<span data-pgof>1</span>', h) + row('b', h) + row('c', h));
    expect(document.querySelector('[data-pgof]')?.textContent).toBe('1 of 2');
  });
});

describe('paginator, ADR-278 opt-in attributes', () => {
  const avail = PAGE_H - HEAD - FOOT_H;

  it('carries every row sharing a key, in order, and marks data-contd', () => {
    const h = Math.floor(avail / 2);
    paginate(
      row('band', 20, 'data-head-for="d" data-contd') +
        row('cols', 20, 'data-head-for="d"') +
        row('a', h, 'data-carry-head="d"') +
        row('b', h, 'data-carry-head="d"'),
    );
    expect(pages()).toEqual([
      ['band', 'cols', 'a'],
      ['band · contd.', 'cols', 'b'],
    ]);
  });

  it('carries several keys named on one row', () => {
    const h = Math.floor(avail / 2);
    paginate(
      row('band', 20, 'data-head-for="d"') +
        row('tl head', 20, 'data-head-for="t"') +
        row('a', h, 'data-carry-head="d t"') +
        row('b', h, 'data-carry-head="d t"'),
    );
    expect(pages()[1]).toEqual(['band', 'tl head', 'b']);
  });

  it('moves a data-keep-next chain together when it does not fit', () => {
    paginate(
      row('a', avail - 50) +
        row('band', 30, 'data-keep-next') +
        row('cols', 30, 'data-keep-next') +
        row('entry', 30),
    );
    expect(pages()).toEqual([['a'], ['band', 'cols', 'entry']]);
  });

  it('does not move a chain from an empty page, and fills on when it is taller than a page', () => {
    paginate(row('band', avail, 'data-keep-next') + row('entry', 30));
    expect(pages()).toEqual([['band'], ['entry']]);
    paginate(
      row('a', 10) +
        row('band', 30, 'data-keep-next') +
        row('cols', 100, 'data-keep-next') +
        row('big', avail - 100),
    );
    expect(pages()).toEqual([['a'], ['band', 'cols'], ['big']]);
  });

  it('starts a new page on data-page-break, unless the page is empty', () => {
    paginate(row('a', 10) + row('b', 10, 'data-page-break'));
    expect(pages()).toEqual([['a'], ['b']]);
    paginate(row('a', 10, 'data-page-break') + row('b', 10));
    expect(pages()).toEqual([['a', 'b']]);
  });

  it('fills data-page-ref with the page of data-page-anchor; a copy never wins', () => {
    const h = Math.floor(avail / 2);
    paginate(
      row('<span id="r" data-page-ref="k">—</span><span id="m" data-page-ref="none">—</span>', 5) +
        row('band', 20, 'data-head-for="d" data-page-anchor="d1"') +
        row('a', h, 'data-carry-head="d"') +
        row('b', h, 'data-carry-head="d" data-page-anchor="k"') +
        row('<span id="d1" data-page-ref="d1">—</span>', 5),
    );
    expect(document.getElementById('r')?.textContent).toBe('2');
    expect(document.getElementById('m')?.textContent).toBe('—');
    expect(document.getElementById('d1')?.textContent).toBe('1');
  });

  it('gives each page a foot and reserves its height', () => {
    const footed = avail - FOOT_RESERVE;
    paginate(row('a', footed) + row('b', 1), 'data-page-foot="Mayur · October 2026"');
    expect(pages()).toEqual([['a'], ['b']]);
    const feet = [...document.querySelectorAll('.page > .page-foot')];
    expect(feet.map((f) => [...f.children].map((c) => c.textContent))).toEqual([
      ['Mayur · October 2026', 'Page 1 of 2'],
      ['Mayur · October 2026', 'Page 2 of 2'],
    ]);
  });

  it('keeps the table own column grid on every page', () => {
    const h = Math.floor(avail / 2);
    paginate(row('a', h) + row('b', h) + row('c', h), '', '<colgroup><col><col></colgroup>');
    expect(document.querySelectorAll('.page > table > colgroup')).toHaveLength(2);
  });
});
