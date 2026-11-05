import { EmptyState } from '@innovic/web';

export const NoOrders = () => <EmptyState icon="📋">No orders — click + New SO</EmptyState>;

export const AllClear = () => (
  <EmptyState tone="ok" icon="✅">
    All clear — nothing needs attention.
  </EmptyState>
);

export const LoadError = () => (
  <EmptyState tone="error" icon="🚫">
    Could not load Job Cards — check your connection and refresh.
  </EmptyState>
);

export const Inline = () => <EmptyState inline>No documents in this category.</EmptyState>;
