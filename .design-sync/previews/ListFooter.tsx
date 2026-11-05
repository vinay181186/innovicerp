import { Button, ListFooter } from '@innovic/web';

export const AllShown = () => <ListFooter total={23} noun="sales order" hint="Click a row to open its detail page." />;

export const Filtered = () => <ListFooter total={42} shown={12} noun="vendor" />;

export const FetchCapHit = () => <ListFooter total={1240} limit={1000} noun="sales order" />;

export const Pager = () => <ListFooter total={312} page={2} pageSize={25} noun="GRN" onPage={() => {}} />;

export const SummaryAndExcel = () => (
  <ListFooter
    total={18}
    noun="NC"
    summary="Scrap Qty 120 · Rework Qty 34"
    actions={
      <>
        <Button size="sm" variant="ghost">⬇ Download Excel Template</Button>
        <Button size="sm" variant="ghost">📄 Import from Excel</Button>
      </>
    }
  />
);

export const Empty = () => <ListFooter total={0} noun="delivery challan" />;
