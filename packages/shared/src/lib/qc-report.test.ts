import { describe, expect, it } from 'vitest';
import { qcProcessForOperation, qcReportMandatory } from './qc-report';

const P = [
  { code: 'DIR', reportTypeId: 'r1', reportTypeName: 'DIR', reportMandatory: true },
  {
    code: 'Final Inspection',
    reportTypeId: 'r2',
    reportTypeName: 'Final Inspection',
    reportMandatory: false,
  },
  { code: 'ICS', reportTypeId: null, reportTypeName: null, reportMandatory: false },
];

describe('qc-report (ADR-252)', () => {
  it('matches an op name to its process ignoring case and spaces', () => {
    expect(qcProcessForOperation(' dir ', P)?.code).toBe('DIR');
    expect(qcProcessForOperation('Turning', P)).toBeNull();
    expect(qcProcessForOperation(null, P)).toBeNull();
  });
  it('needs the report only for a mandatory type and accepted qty > 0', () => {
    expect(qcReportMandatory('DIR', 15, P)).toBe(true);
    expect(qcReportMandatory('DIR', 0, P)).toBe(false);
    expect(qcReportMandatory('Final Inspection', 40, P)).toBe(false);
    expect(qcReportMandatory('ICS', 5, P)).toBe(false);
    expect(qcReportMandatory('Turning', 5, P)).toBe(false);
  });
});
