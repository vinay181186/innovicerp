// Production-flavoured re-registration of the SO Open Backlog (= SO Line
// Tracker per legacy L20015) report. Same delegation pattern as
// production-item-tracker.ts.
//
// The Production copy carries NO money: the Sales original has a Line Value
// column, which would mark this copy `showsMoney` and hide it from Production
// users whose tier does not see prices. So the column is dropped from the
// definition and stripped from every row the shared run() returns.

import type { RegisteredReport } from '../registry';
import { soOpenBacklogReport } from './so-open-backlog';

const MONEY_KEY = 'line_value';

const columns = soOpenBacklogReport.definition.columns.filter((c) => c.key !== MONEY_KEY);

export const productionSoLineTrackerReport: RegisteredReport = {
  definition: {
    ...soOpenBacklogReport.definition,
    slug: 'production-so-line-tracker',
    title: 'SO Line Tracker',
    group: 'Production',
    dept: 'production',
    showsMoney: false,
    columns,
  },
  async run(ctx) {
    const result = await soOpenBacklogReport.run(ctx);
    return {
      columns: result.columns.filter((c) => c.key !== MONEY_KEY),
      rows: result.rows.map((row) => {
        const rest = { ...row };
        delete rest[MONEY_KEY];
        return rest;
      }),
    };
  },
};
