/** Where the authenticated Supabase session is persisted between the setup
 *  project and the authenticated test projects. Kept in its own module so the
 *  Playwright config can import it without pulling in a test file. */
export const STORAGE_STATE = '.playwright/auth.json';
