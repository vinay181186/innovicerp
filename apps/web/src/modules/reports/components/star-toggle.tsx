// ★ toggle for one report — used by the catalogue chips, the department card
// grid and the report page header. Starred reports show in the catalogue's
// "★ My Reports" row (per user, this browser — see lib/report-prefs.ts).
import { useReportPrefs } from '../lib/report-prefs';

export function StarToggle({ slug, title }: { slug: string; title: string }): React.JSX.Element {
  const { isStarred, toggleStar } = useReportPrefs();
  const on = isStarred(slug);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-pressed={on}
      aria-label={on ? `Remove ${title} from My Reports` : `Add ${title} to My Reports`}
      title={on ? 'Remove from My Reports' : 'Add to My Reports'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleStar(slug);
      }}
      style={{ color: on ? 'var(--amber)' : 'var(--text3)', padding: '0 6px' }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
