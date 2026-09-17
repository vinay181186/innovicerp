// Re-export shared Zod schemas. Per CLAUDE.md §8, modules may host their own
// schemas or re-export from @innovic/shared; we re-export so the source of
// truth stays in the shared package and frontend uses the same types.
export {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_KIND_META,
  GLOBAL_SEARCH_KINDS,
  GLOBAL_SEARCH_MAX_LIMIT,
  GLOBAL_SEARCH_MIN_CHARS,
  globalSearchKindSchema,
  globalSearchQuerySchema,
  globalSearchResponseSchema,
  globalSearchResultSchema,
} from '@innovic/shared';
export type {
  GlobalSearchKind,
  GlobalSearchKindMeta,
  GlobalSearchQuery,
  GlobalSearchResponse,
  GlobalSearchResult,
} from '@innovic/shared';
