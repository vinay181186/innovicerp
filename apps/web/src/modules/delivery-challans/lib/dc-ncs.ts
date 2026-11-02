// Every NC a return-to-vendor DC carries (0237 — one DC may hold several NCs of
// one SO), in line order. Read defensively: the API client returns bodies
// unparsed, so `ncs` is missing on an API that predates it — and a DC raised
// before 0237 has only the header `ncId`. Both fall back to that one NC. An
// ordinary OSP DC answers [].

export interface DcNcRef {
  id: string;
  code: string;
}

export function dcNcs(dc: {
  ncId: string | null;
  ncCode: string | null;
  poCodeText: string;
  ncs?: DcNcRef[] | undefined;
}): DcNcRef[] {
  if (dc.ncs && dc.ncs.length > 0) return dc.ncs;
  return dc.ncId ? [{ id: dc.ncId, code: dc.ncCode ?? dc.poCodeText }] : [];
}
