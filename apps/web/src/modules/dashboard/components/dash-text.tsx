// ADR-250 — how the home renders a document number and a DashText.
//
// Every document number on the home goes through <DocRef>: an ActionLink with
// fallback="text" (ADR-234) — a link when the caller may open that page, plain
// grey text (no pointer, not clickable) when not (`span.dh-link` in home.css).
// The server always sends the href; whether it opens is the shared page-access
// rule, never decided here.

import type { DashText } from '@innovic/shared';
import type { ComponentProps } from 'react';
import { ActionLink, hrefLink } from '@/components/shared/action-link';

type LinkTo = NonNullable<ComponentProps<typeof ActionLink>['to']>;

/** A server href ('/purchase-orders/<id>', '/nc-register?tab=capa') as router
 *  props for <ActionLink>. The path is a concrete URL the server built, so it
 *  is cast to the router's path type (as stat-strip / related-ref-link do). */
export function linkProps(href: string): { to: LinkTo; search?: never } {
  const l = hrefLink(href);
  return l.search ? { to: l.to as LinkTo, search: l.search as never } : { to: l.to as LinkTo };
}

export function DocRef({ code, href }: { code: string; href: string }): React.JSX.Element | null {
  return (
    <ActionLink {...linkProps(href)} check={href} fallback="text" className="dh-link">
      {code}
    </ActionLink>
  );
}

/** One DashText (text + code parts) as inline content. */
export function DashTextView({ text }: { text: DashText }): React.JSX.Element {
  return (
    <>
      {text.map((p, i) =>
        'code' in p ? (
          <DocRef key={i} code={p.code} href={p.href} />
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
