// ADR-293 — the AI chat's tool allow-list, by name. No imports on purpose, so
// the unit test can read it without a database. tools.ts is typed against it:
// a tool missing here, or an extra one there, fails the build.
export const AI_CHAT_TOOL_NAMES = [
  'search_documents',
  'list_documents',
  'list_lines',
  'get_document',
  'item_stock',
  'list_reports',
  'run_report',
] as const;
export type AiChatToolName = (typeof AI_CHAT_TOOL_NAMES)[number];
