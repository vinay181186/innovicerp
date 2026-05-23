// Production-flavoured re-registration of the SO Open Backlog (= SO Line
// Tracker per legacy L20015) report. Same delegation pattern as
// production-item-tracker.ts.

import type { RegisteredReport } from '../registry';
import { soOpenBacklogReport } from './so-open-backlog';

export const productionSoLineTrackerReport: RegisteredReport = {
  definition: {
    ...soOpenBacklogReport.definition,
    slug: 'production-so-line-tracker',
    title: 'SO Line Tracker',
    group: 'Production',
  },
  run: soOpenBacklogReport.run,
};
