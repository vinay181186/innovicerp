// Raw Material Master — ONE page, two masters behind a Grade | Size tab strip.
//
// The two masters are deliberately INDEPENDENT: a size is not scoped to a grade,
// so picking EN24 never narrows the size list. They share a page (and a menu
// entry) only because they are always filled in together.
//
// The tab lives in the URL search param (?tab=size; absent = grade) so a tab is
// bookmarkable — same pattern as Op Entry's "By Job Card / By Machine" strip.
// The search box lives there too, and is cleared when the tab changes because
// the two lists have nothing in common.

import { createRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { GradeTab } from '../components/grade-tab';
import { SizeTab } from '../components/size-tab';

const searchSchema = z.object({
  tab: z.enum(['size']).optional(),
  search: z.string().optional(),
});

export const rawMaterialRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'raw-material',
  validateSearch: searchSchema,
  component: RawMaterialPage,
});

const TABS = [
  { key: 'grade', label: '🧪 Grade' },
  { key: 'size', label: '📏 Size' },
] as const;

function RawMaterialPage(): React.JSX.Element {
  const search = rawMaterialRoute.useSearch();
  const navigate = rawMaterialRoute.useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'rawmat_create');

  const tab = search.tab ?? 'grade';

  // Debounce the search box into the URL once, here, so both tabs share it.
  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      <div className="section-hdr">Raw Material Master</div>

      {/* Grade | Size switch — same strip as Op Entry's By Job Card / By Machine. */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() =>
              void navigate({
                // Switching master clears the search term — a grade search means
                // nothing on the size list.
                search: () => (t.key === 'grade' ? {} : { tab: 'size' }),
                replace: true,
              })
            }
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t.key ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'size' ? (
        <SizeTab term={search.search} searchInput={searchInput} onSearchInput={setSearchInput} />
      ) : (
        <GradeTab term={search.search} searchInput={searchInput} onSearchInput={setSearchInput} />
      )}
    </div>
  );
}
