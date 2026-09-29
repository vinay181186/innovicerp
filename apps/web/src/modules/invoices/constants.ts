/**
 * Payment Terms prefilled when the customer has no Payment Days set
 * (ADR-188). Display prefill only — the server applies the same default when
 * a request omits the terms.
 */
export const DEFAULT_TERMS_DAYS = 45;

/** GST % choices offered on the invoice form. */
export const GST_OPTIONS = ['0', '5', '12', '18', '28'];
