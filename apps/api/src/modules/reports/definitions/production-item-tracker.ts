// Production-flavoured re-registration of the Item Tracker report.
// Legacy `_deptReportTabs` (HTML L20020) shares Item Tracker between Sales
// and Production departments. Our registry is slug-keyed, so we create a
// separate slug with `group: 'Production'` that delegates to the existing
// itemTrackerReport.run().

import type { RegisteredReport } from '../registry';
import { itemTrackerReport } from './item-tracker';

export const productionItemTrackerReport: RegisteredReport = {
  definition: {
    ...itemTrackerReport.definition,
    slug: 'production-item-tracker',
    group: 'Production',
  },
  run: itemTrackerReport.run,
};
