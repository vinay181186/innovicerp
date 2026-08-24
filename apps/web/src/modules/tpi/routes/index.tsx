// TPI — Third Party Inspection (legacy renderTPI L21381). Backed by op_log with
// isTpi + tpi metadata (migration 0037).
//
// The screen itself now lives in ../components/tpi-view so it can be mounted
// both here (its own route) and as the "🔍 TPI" tab on QC Call Register.

import { createRoute } from '@tanstack/react-router';
import { authenticatedRoute } from '@/routes/_authenticated';
import { TpiView } from '../components/tpi-view';

export const tpiRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi',
  component: TpiPage,
});

function TpiPage(): React.JSX.Element {
  return <TpiView title="🔍 TPI (Third Party Inspection)" />;
}
