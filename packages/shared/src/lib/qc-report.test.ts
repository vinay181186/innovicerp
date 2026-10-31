import { describe, expect, it } from 'vitest';
import { qcProcessForOperation, qcReportMandatory } from './qc-report';

const P = [
  {
    code: 'DIR',
    reportTypeId: 'r1',
    reportTypeName: 'DIR',
    reportMandatory: true,
    reportLastStageOnly: true,
  },
  {
    code: 'Final Inspection',
    reportTypeId: 'r2',
    reportTypeName: 'Final Inspection',
    reportMandatory: false,
    reportLastStageOnly: false,
  },
  {
    code: 'TPI',
    reportTypeId: 'r3',
    reportTypeName: 'TPI',
    reportMandatory: true,
    reportLastStageOnly: false,
  },
  {
    code: 'ICS',
    reportTypeId: null,
    reportTypeName: null,
    reportMandatory: false,
    reportLastStageOnly: false,
  },
];

describe('qc-report (ADR-252)', () => {
  it('matches an op name to its process ignoring case and spaces', () => {
    expect(qcProcessForOperation(' dir ', P)?.code).toBe('DIR');
    expect(qcProcessForOperation('Turning', P)).toBeNull();
    expect(qcProcessForOperation(null, P)).toBeNull();
  });
  it('needs the report only for a mandatory type and accepted qty > 0', () => {
    expect(qcReportMandatory('DIR', 15, P, true)).toBe(true);
    expect(qcReportMandatory('DIR', 0, P, true)).toBe(false);
    expect(qcReportMandatory('Final Inspection', 40, P, true)).toBe(false);
    expect(qcReportMandatory('ICS', 5, P, true)).toBe(false);
    expect(qcReportMandatory('Turning', 5, P, true)).toBe(false);
  });
  it('Last Stage Only: compulsory on the last op, optional in the middle', () => {
    expect(qcReportMandatory('DIR', 15, P, false)).toBe(false);
    expect(qcReportMandatory('DIR', 15, P, true)).toBe(true);
  });
  it('a mandatory type without Last Stage Only stays compulsory everywhere', () => {
    expect(qcReportMandatory('TPI', 5, P, false)).toBe(true);
    expect(qcReportMandatory('TPI', 5, P, true)).toBe(true);
  });
});
