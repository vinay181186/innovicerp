import { createRouter } from '@tanstack/react-router';
import { clientsListRoute } from './modules/clients/routes/list';
import { clientDetailRoute } from './modules/clients/routes/detail';
import { clientEditRoute, clientNewRoute } from './modules/clients/routes/edit';
import { itemsListRoute } from './modules/items/routes/list';
import { itemDetailRoute } from './modules/items/routes/detail';
import { itemEditRoute, itemNewRoute } from './modules/items/routes/edit';
import { machinesListRoute } from './modules/machines/routes/list';
import { machineDetailRoute } from './modules/machines/routes/detail';
import { machineEditRoute, machineNewRoute } from './modules/machines/routes/edit';
import { opEntryRoute } from './modules/op-entry/routes/index';
import { runningOpsRoute } from './modules/op-entry/routes/running';
import { operatorsListRoute } from './modules/operators/routes/list';
import { operatorDetailRoute } from './modules/operators/routes/detail';
import { operatorEditRoute, operatorNewRoute } from './modules/operators/routes/edit';
import { vendorsListRoute } from './modules/vendors/routes/list';
import { vendorDetailRoute } from './modules/vendors/routes/detail';
import { vendorEditRoute, vendorNewRoute } from './modules/vendors/routes/edit';
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
    clientsListRoute,
    clientNewRoute,
    clientDetailRoute,
    clientEditRoute,
    vendorsListRoute,
    vendorNewRoute,
    vendorDetailRoute,
    vendorEditRoute,
    machinesListRoute,
    machineNewRoute,
    machineDetailRoute,
    machineEditRoute,
    operatorsListRoute,
    operatorNewRoute,
    operatorDetailRoute,
    operatorEditRoute,
    opEntryRoute,
    runningOpsRoute,
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
