import { Button, ListHeader } from '@innovic/web';

export const SalesOrders = () => (
  <ListHeader
    title="SO Master"
    icon="📋"
    count={128}
    noun="line"
    search=""
    onSearch={() => {}}
    searchPlaceholder="Search SO no., customer, item…"
    primary={<Button variant="primary">+ New SO</Button>}
  />
);
