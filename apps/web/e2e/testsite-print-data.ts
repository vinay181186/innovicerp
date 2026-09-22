// The 45 PO lines used by testsite-print.spec.ts. Every free-text value carries
// the E2E_ marker so the rows are findable afterwards.

export interface PoLineSpec {
  code: string;
  name: string;
  qty: number;
  rate: number;
  remarks?: string;
}

const NAMES = [
  'E2E_ Hexagon Head Bolt M12 x 60',
  'E2E_ Bronze Flanged Bushing CW705R',
  'E2E_ Automatic Fire Check Lever EN26 Forged',
  'E2E_ Gudgeon Pin',
  'E2E_ Hydraulic Cylinder Barrel Honed 80 Bore x 1200 Long',
  'E2E_ Spacer Ring 40 ID',
  'E2E_ Split Pin 3 x 25',
  'E2E_ Gearbox Housing Casting Machined and Line Bored',
  'E2E_ Thrust Washer PTFE Lined',
  'E2E_ Grub Screw M6',
  'E2E_ Rotor Shaft EN24 Hardened and Tempered 280 BHN',
  'E2E_ Bearing Retainer Plate',
  'E2E_ Dowel Pin 8 x 30',
  'E2E_ Impeller Casting SS316 Dynamically Balanced',
  'E2E_ Oil Seal Housing Cap',
  'E2E_ Copper Washer 12 mm',
  'E2E_ Crank Web Forging EN24 Rough Turned',
  'E2E_ Locking Collar Split Type',
  'E2E_ Circlip External 25 mm',
  'E2E_ Pump Body Machined From LM6 Casting',
  'E2E_ Distance Piece Turned',
  'E2E_ Taper Key 10 x 8 x 45',
  'E2E_ Coupling Half Bored and Keywayed',
  'E2E_ Shim Plate 0.5 mm',
  'E2E_ Valve Seat Insert Stellite Faced',
  'E2E_ Adaptor Flange Drilled 8 Holes',
  'E2E_ Guide Bush Phosphor Bronze',
  'E2E_ Set Screw M8 x 20',
  'E2E_ Piston Rod Chrome Plated 45 mm x 900',
  'E2E_ End Cover Plate Machined',
  'E2E_ Sleeve Nut',
  'E2E_ Eccentric Cam Hardened',
  'E2E_ Plain Washer M10',
  'E2E_ Bracket Fabricated and Stress Relieved',
  'E2E_ Gear Blank 24T Module 4 Hobbed',
  'E2E_ Cover Gasket Cut To Drawing',
  'E2E_ Pin Retainer Clip',
  'E2E_ Bush Housing Bored',
  'E2E_ Wear Ring Cast Iron',
  'E2E_ Main Body Forging EN8D Proof Machined 320 kg',
  'E2E_ Lock Nut M20',
  'E2E_ Support Leg Welded Assembly',
  'E2E_ Spring Retaining Cup',
  'E2E_ Cylinder Head Machined and Pressure Tested',
  'E2E_ Nipple 1/4 BSP',
];

const QTYS = [
  1, 2, 5, 8, 3, 10, 12, 15, 20, 25, 30, 36, 40, 45, 50, 60, 72, 75, 80, 90, 100, 110, 120, 125,
  144, 150, 160, 175, 180, 200, 220, 240, 250, 275, 300, 320, 350, 375, 400, 450, 480, 500, 550,
  600, 750,
];

const RATES = [
  9.5, 4.25, 120, 1250, 99999, 87.5, 3.75, 45000, 660.4, 2.2, 18750, 505.75, 1.1, 9800, 320, 12.4,
  6250, 143.2, 2.5, 4500, 250, 7.85, 3600.75, 88.4, 1.75, 2750, 62, 5.6, 1899, 105.6, 0.9, 1650.4,
  47.8, 6.6, 1080.6, 33.33, 2.05, 950, 19.75, 4.4, 725, 15.5, 2.8, 380, 66.66,
];

// Six lines carry a line remark; the rest must stay two lines tall on paper.
export const REMARK_LINES: Record<number, string> = {
  3: 'E2E_ machine to drawing rev C, edges to be deburred and lightly chamfered before despatch.',
  11: 'E2E_ material test certificate EN 10204 3.1 to accompany each batch.',
  19: 'E2E_ pack in VCI paper, 50 per carton, mark the carton with our PO number.',
  27: 'E2E_ bore to be finish ground after heat treatment, Ra 0.8 maximum.',
  35: 'E2E_ first article inspection report required before bulk production starts.',
  44: 'E2E_ hydrotest at 1.5 times working pressure, hold 30 minutes, report to be supplied.',
};

export const PO_LINES: PoLineSpec[] = NAMES.map((name, i) => {
  const n = i + 1;
  const spec: PoLineSpec = {
    code: `E2E-PRT-${String(n).padStart(3, '0')}`,
    name,
    qty: QTYS[i] as number,
    rate: RATES[i] as number,
  };
  if (REMARK_LINES[n]) spec.remarks = REMARK_LINES[n] as string;
  return spec;
});

export const VENDOR = {
  name: 'E2E_ Shreeji Precision Heat Treaters Pvt Ltd',
  contactPerson: 'E2E_ Rakesh Patel',
  phone: '9876543210',
  email: 'e2e.testvendor@example.com',
  gstNumber: '24AAECS1429P1ZP',
  addressLine1: 'E2E_ Plot No. 214/B, Phase IV, GIDC Industrial Estate, Vithal Udyognagar',
  city: 'Anand',
  state: 'Gujarat',
  pincode: '388121',
};
