// ADR-250/262 — the quiet empty line and the "View all (n)" link used by the
// Approval inbox.

import { ActionLink } from '@/components/shared/action-link';
import { linkProps } from './dash-text';

export function Empty({ text }: { text: string }): React.JSX.Element {
  return <div className="dh-empty">{text}</div>;
}

/** "View all (total)" — only when the list holds more than it shows. */
export function ViewAll({ href, total }: { href: string; total: number }): React.JSX.Element {
  return (
    <div className="dh-more">
      <ActionLink {...linkProps(href)} check={href} className="dh-link">
        View all ({total})
      </ActionLink>
    </div>
  );
}
