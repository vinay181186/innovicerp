// CAPA — Corrective & Preventive Action (legacy renderCAPA L22779 + _capaNew /
// _capaEdit 5-step). Backed by /capa (capa_records, migration 0034).
//
// The screen itself now lives in ../components/capa-view so it can be mounted
// both here (its own route) and as the "🛡 CAPA" tab on NC Register.

import { createRoute } from '@tanstack/react-router';
import { authenticatedRoute } from '@/routes/_authenticated';
import { CapaView } from '../components/capa-view';

export const capaListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'capa',
  component: CapaPage,
});

function CapaPage(): React.JSX.Element {
  return <CapaView title="🛡 CAPA — Corrective & Preventive Action" />;
}
