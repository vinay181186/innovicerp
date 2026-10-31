// Drawing Rev Fix List (Phase D, owner model 2026-10-31) — the hand-fix work
// left by moving to "one drawing per Item + Drawing Rev":
//
//   Route Cards    old cards of make items with no Drawing Rev; a new
//                  Production Order cannot use one until its Rev is set.
//   Order Lines    live SO / JWSO lines of an item whose live lines carry more
//                  than one Rev, or a suspicious Rev "0".
//   Old Stock      stock of make items in the blank (no-Rev) bucket; "Set Rev"
//                  moves it onto an Item + Rev.
//
// One read (GET /item-revisions/fix-list) answers all three; the lists are
// bounded fix lists, not registers, so they are shown whole. Each list
// empties itself as the team fixes rows.

import type { FixListStock } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useItemRevisionFixList } from '../api';
import { lineColumns, routeCardColumns, stockColumns } from '../components/fix-list-columns';
import { SetStockRevDialog } from '../components/set-stock-rev-dialog';

export const drawingRevFixListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'drawing-rev-fix-list',
  component: DrawingRevFixListPage,
});

type TabKey = 'route-cards' | 'lines' | 'stock';

function DrawingRevFixListPage(): React.JSX.Element {
  const { data, isLoading, isError, error, isFetching } = useItemRevisionFixList();
  const { data: eff } = useMyAccess();
  // The server checks every write; the screen only hides what this user
  // cannot do. Setting an old card's Rev is a Route Card edit; moving old
  // stock onto a Rev is a store stock write (same tick as ± Adjust).
  const canEditRc = effectiveFormPerms(eff, 'routecard_create').edit;
  const canSetRev = effectiveFormPerms(eff, 'item_create').edit;
  const [tab, setTab] = useState<TabKey>('route-cards');
  const [stockRow, setStockRow] = useState<FixListStock | null>(null);

  if (isError) {
    return (
      <PageState
        state="error"
        message={error instanceof Error ? error.message : 'Could not load the fix list. Try again.'}
      />
    );
  }

  const routeCards = data?.routeCards ?? [];
  const lines = data?.lines ?? [];
  const stock = data?.stock ?? [];
  const total = routeCards.length + lines.length + stock.length;

  return (
    <div>
      <ListHeader
        title="Drawing Rev Fix List"
        icon="🛠"
        count={total}
        noun="row to fix"
        nounPlural="rows to fix"
        updating={isFetching && !isLoading}
      />
      <TabStrip
        label="Drawing Rev Fix List"
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          {
            key: 'route-cards',
            label: 'Route Cards without Drawing Rev',
            count: routeCards.length,
          },
          { key: 'lines', label: 'Order Lines to check', count: lines.length },
          { key: 'stock', label: 'Old Stock without Drawing Rev', count: stock.length },
        ]}
      />
      <Panel fill bodyPadding="none">
        {tab === 'route-cards' ? (
          <DataTable
            tableKey={TABLE_KEYS.drawingRevFixRouteCards}
            columns={routeCardColumns(canEditRc)}
            rows={routeCards}
            loading={isLoading}
            rowKey={(r) => r.routeCardId}
            emptyText="Every Route Card has its Drawing Rev."
          />
        ) : tab === 'lines' ? (
          <DataTable
            tableKey={TABLE_KEYS.drawingRevFixLines}
            columns={lineColumns()}
            rows={lines}
            loading={isLoading}
            rowKey={(r) => r.lineId}
            emptyText="No order lines with conflicting Drawing Revs or Rev 0."
          />
        ) : (
          <DataTable
            tableKey={TABLE_KEYS.drawingRevFixStock}
            columns={stockColumns(canSetRev, setStockRow)}
            rows={stock}
            loading={isLoading}
            rowKey={(r) => r.itemId}
            emptyText="No old stock without a Drawing Rev."
          />
        )}
      </Panel>
      {stockRow ? <SetStockRevDialog row={stockRow} onClose={() => setStockRow(null)} /> : null}
    </div>
  );
}
