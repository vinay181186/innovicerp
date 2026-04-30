import { createRouter } from '@tanstack/react-router';
import { itemsListRoute } from './modules/items/routes/list';
import { itemDetailRoute } from './modules/items/routes/detail';
import { itemEditRoute, itemNewRoute } from './modules/items/routes/edit';
import { authCallbackRoute } from './routes/auth-callback';
import { authenticatedRoute } from './routes/_authenticated';
import { indexRoute } from './routes/index';
import { loginRoute } from './routes/login';
import { rootRoute } from './routes/__root';

const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    itemsListRoute,
    itemNewRoute,
    itemDetailRoute,
    itemEditRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
