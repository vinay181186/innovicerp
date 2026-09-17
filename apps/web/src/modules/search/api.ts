// Search module — data hooks.
//
// The query hook and the "where does a row open" map live in
// `@/lib/global-search` because the header box (components/shared) needs the
// same constants; this file re-exports them so the module keeps the standard
// api.ts / components / routes shape.

export { GLOBAL_SEARCH_LANDING_KIND, openSearchResult, useGlobalSearch } from '@/lib/global-search';
export type { UseGlobalSearchArgs } from '@/lib/global-search';
