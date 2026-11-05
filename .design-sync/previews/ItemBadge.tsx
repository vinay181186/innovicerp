import { ItemBadge } from '@innovic/web';

export const RowSize = () => (
  <ItemBadge code="BRKT-101" revision="A" name="Mounting Bracket, MS Plate 10 mm" size="row" />
);

export const CardSize = () => (
  <ItemBadge code="SHFT-204" revision="C" name="Drive Shaft, EN8 Dia 40" size="card" />
);

export const PageSize = () => (
  <ItemBadge code="HSG-310" revision="B" name="Gearbox Housing, CI FG260" size="page" />
);

export const CodeOnly = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <ItemBadge code="BRKT-101" revision="A" name="Mounting Bracket, MS Plate 10 mm" showImage={false} />
    <ItemBadge code="FLNG-118" name="Weld Neck Flange, SS304" showImage={false} />
  </div>
);

export const Tile = () => (
  <ItemBadge code="BRKT-101" revision="A" name="Mounting Bracket, MS Plate 10 mm" size="tile" />
);
