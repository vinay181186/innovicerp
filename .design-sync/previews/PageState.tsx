import { Button, PageState } from '@innovic/web';

export const Loading = () => <PageState state="loading" />;

export const Empty = () => (
  <PageState
    state="empty"
    icon="📋"
    message="No sales orders yet — click + New SO."
    action={<Button variant="primary" size="sm">+ New SO</Button>}
  />
);

export const LoadFailed = () => (
  <PageState
    state="error"
    title="Failed to load Job Cards"
    message="Could not load this data. Try again."
    action={<Button variant="ghost" size="sm">Retry</Button>}
  />
);

export const NoAccess = () => <PageState state="noaccess" />;

export const InTableRow = () => (
  <table className="innovic-table">
    <thead>
      <tr><th>SO No.</th><th>Customer</th><th>Due Date</th></tr>
    </thead>
    <tbody>
      <PageState as="row" colSpan={3} state="empty" message="No lines on this order" />
    </tbody>
  </table>
);

export const Inline = () => <PageState as="inline" state="loading" message="⟳ Loading operations…" />;
