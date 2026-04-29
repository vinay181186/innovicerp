import { createRouter } from '@tanstack/react-router';
import { authCallbackRoute } from './routes/auth-callback';
import { authenticatedRoute } from './routes/_authenticated';
import { indexRoute } from './routes/index';
import { loginRoute } from './routes/login';
import { rootRoute } from './routes/__root';

const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  authenticatedRoute.addChildren([indexRoute]),
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
