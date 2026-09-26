// ★ toggle for one report. It lives in exactly two places: right after the
// title on a report page, and in the fixed 28px last slot of a report row /
// tile in the catalogue. Starred reports show in the catalogue's "★ My
// Reports" section (per user, this browser — see lib/report-prefs.ts).
import { useReportPrefs } from '../lib/report-prefs';

export function StarToggle({ slug, title }: { slug: string; title: string }): React.JSX.Element {
  const { isStarred, toggleStar } = useReportPrefs();
  const on = isStarred(slug);
  return (
    <button
      type="button"
      className={on ? 'rpt-star is-on' : 'rpt-star'}
      aria-pressed={on}
      aria-label={on ? `Remove ${title} from My Reports` : `Add ${title} to My Reports`}
      title={on ? 'Remove from My Reports' : 'Add to My Reports'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleStar(slug);
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
