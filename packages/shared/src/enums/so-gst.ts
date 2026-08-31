// GST rates offered on a Sales Order — the single source of truth for the SO
// form's "GST %" dropdown and its default. Add a slab here and the dropdown
// picks it up; nothing else hard-codes the list.
export const SO_GST_PERCENTS = [0, 5, 12, 18, 28] as const;

export type SoGstPercent = (typeof SO_GST_PERCENTS)[number];

/** Rate a new Sales Order opens with. */
export const SO_GST_DEFAULT: SoGstPercent = 18;
