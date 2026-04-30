import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';

export const rootRoute = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </>
  );
}
