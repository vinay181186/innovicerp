// ADR-250 — home header row (avatar · greeting · dept · updated · My
// department/Mine · bell · Widgets/Customize/Refresh), the headline, and the
// one-row cue strip.

import { ACCESS_DEPTS, type DashCue, type HomeResponse, type HomeScope } from '@innovic/shared';
import { ActionLink } from '@/components/shared/action-link';
import { roleLabel } from '@/lib/role-label';
import { fmtTime } from '@/lib/date';
import { DashTextView, linkProps } from './dash-text';

export type HomeMode = 'home' | 'widgets' | 'customize';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}

export function HomeHeader({
  home,
  updatedAt,
  mode,
  onMode,
  onRefresh,
  scope,
  onScope,
  onBell,
}: {
  home: HomeResponse;
  updatedAt: number;
  mode: HomeMode;
  onMode: (m: HomeMode) => void;
  onRefresh: () => void;
  scope: HomeScope;
  onScope: (s: HomeScope) => void;
  onBell: () => void;
}): React.JSX.Element {
  const greet = home.greetingPart.charAt(0).toUpperCase() + home.greetingPart.slice(1);
  const first = home.userName.trim().split(/\s+/)[0] ?? home.userName;
  const dept =
    ACCESS_DEPTS.find((d) => d.key === home.mainDept)?.label ??
    home.mainDept ??
    roleLabel(home.role);
  return (
    <header className="dh-top">
      <div className="dh-av" aria-hidden="true">
        {initials(home.userName)}
      </div>
      <h1>
        Good {greet}, {first}{' '}
        <span className="dh-meta">
          · {dept} · updated {fmtTime(updatedAt)} · live
        </span>
      </h1>
      {mode === 'home' ? (
        <span className="dh-seg">
          <button type="button" aria-pressed={scope === 'dept'} onClick={() => onScope('dept')}>
            My department
          </button>
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => onScope('mine')}>
            Mine
          </button>
        </span>
      ) : null}
      {mode === 'home' ? (
        <button
          type="button"
          className="dh-bell"
          title="Notifications"
          aria-label={`Notifications, ${home.notifications.unseen} new`}
          onClick={onBell}
        >
          🔔 <b>{home.notifications.unseen}</b>
        </button>
      ) : null}
      {/* These switch the page's whole content; aria-pressed says which is on. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-ghost ${mode === 'widgets' ? 'active' : ''}`}
          style={{ fontSize: 11 }}
          aria-pressed={mode === 'widgets'}
          onClick={() => onMode(mode === 'widgets' ? 'home' : 'widgets')}
        >
          Widgets
        </button>
        <button
          type="button"
          className={`btn btn-ghost ${mode === 'customize' ? 'active' : ''}`}
          style={{ fontSize: 11 }}
          aria-pressed={mode === 'customize'}
          onClick={() => onMode(mode === 'customize' ? 'home' : 'customize')}
        >
          Customize
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 11 }}
          aria-label="Refresh dashboard"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    </header>
  );
}

function Cue({ cue }: { cue: DashCue }): React.JSX.Element {
  const body = (
    <>
      <span className="dh-n">{cue.count}</span>
      <span>{cue.label}</span>
      {cue.sub ? <span className="dh-s">{cue.sub}</span> : null}
    </>
  );
  const cls = `dh-cue t-${cue.tone}`;
  if (!cue.href) return <div className={cls}>{body}</div>;
  // Not openable → the same cue as plain text (ActionLink fallback).
  return (
    <ActionLink
      {...linkProps(cue.href)}
      check={cue.href}
      fallback="text"
      className={cls}
      title={`Open ${cue.label}`}
    >
      {body}
    </ActionLink>
  );
}

export function HomeHeadline({ home }: { home: HomeResponse }): React.JSX.Element | null {
  return (
    <>
      {home.headline.length > 0 ? (
        <div className="dh-headline">
          <DashTextView text={home.headline} />
        </div>
      ) : null}
      {home.cues.length > 0 ? (
        <div className="dh-cues">
          {home.cues.map((c) => (
            <Cue key={c.key} cue={c} />
          ))}
        </div>
      ) : null}
    </>
  );
}
