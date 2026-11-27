// Reports › SO / JWSO Status (ADR-325) — the days list. From / To / mode live
// in the address, so Back from a day returns to the same range.

import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { todayIst } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SoJwsoDaysView } from '../components/days-view';
import { DAYS_MODES, type DaysRange, resolveRange } from '../lib/days';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const daysSearchSchema = z.object({
  from: isoDate,
  to: isoDate,
  mode: z.enum(DAYS_MODES).optional().catch(undefined),
});

export const soJwsoDaysRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-jwso-status',
  validateSearch: daysSearchSchema,
  component: SoJwsoDaysPage,
});

function SoJwsoDaysPage(): React.JSX.Element {
  const search = soJwsoDaysRoute.useSearch();
  const navigate = soJwsoDaysRoute.useNavigate();
  const range = resolveRange(search, todayIst());
  const onRange = (next: DaysRange): void => {
    void navigate({ search: { from: next.from, to: next.to, mode: next.mode }, replace: true });
  };
  return <SoJwsoDaysView range={range} onRange={onRange} />;
}
