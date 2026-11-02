// A waiting / decided approval's document number: mono bold, a link to the
// document's page when the caller may open it, plain text otherwise (and
// when the server sends no page). Page access is the shared ActionLink rule.

import { ActionLink } from '@/components/shared/action-link';
import { linkProps } from '@/modules/dashboard/components/dash-text';

export function ApprovalDocLink({
  code,
  href,
}: {
  code: string;
  href: string | null;
}): React.JSX.Element {
  return (
    <span className="apv-doc">
      {href ? (
        <ActionLink {...linkProps(href)} check={href} fallback="text" className="apv-link">
          {code}
        </ActionLink>
      ) : (
        code
      )}
    </span>
  );
}
