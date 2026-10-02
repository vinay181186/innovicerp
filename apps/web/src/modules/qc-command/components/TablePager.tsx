// QC Command — the Prev / Next pager under each board table (ADR-201: 25 rows
// a page, only that page loaded; `total` is the server's whole-set count).

import { LIST_PAGE_SIZE } from '@/lib/list-paging';
import { ListFooter } from '@/ui/layout';

export interface QcPager {
  page: number;
  total: number;
  onPage: (p: number) => void;
}

/** Sr No / rank of the i-th row on the current page. */
export function rowNo(pager: QcPager, i: number): number {
  return (pager.page - 1) * LIST_PAGE_SIZE + i + 1;
}

export function TablePager({
  pager,
  noun,
  nounPlural,
}: {
  pager: QcPager;
  noun: string;
  nounPlural?: string;
}): React.JSX.Element {
  return (
    <div style={{ padding: '0 14px 10px' }}>
      <ListFooter
        total={pager.total}
        page={pager.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={pager.onPage}
        noun={noun}
        nounPlural={nounPlural}
      />
    </div>
  );
}
