// The search box above a Day Log entry table (My Day Log; Team Day Logs › a
// person): the shared SearchInput, and "Showing n of m entries" while a term
// narrows the rows. The matching itself is the shared matchesSearchTerm
// (components/shared/search-match) — the whole day is loaded, so it runs in
// the browser.

import { SearchInput } from '@/ui/forms';

export function EntrySearch({
  value,
  onChange,
  placeholder,
  shown,
  total,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  shown: number;
  total: number;
}): React.JSX.Element {
  const filtered = value.trim() !== '';
  return (
    <div className="dl-searchbar" role="search">
      <SearchInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label="Search entries"
      />
      {filtered ? (
        <span className="text3 dl-small">
          Showing {shown} of {total} {total === 1 ? 'entry' : 'entries'}
        </span>
      ) : null}
      {filtered ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>
          Clear search
        </button>
      ) : null}
    </div>
  );
}
