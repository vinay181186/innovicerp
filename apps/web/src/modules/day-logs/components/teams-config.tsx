// "Teams Config" tab (owner 2026-10-30) — a Super Admin decides who sees whose
// Day Log. Pick a User, pick a team mate, + Add: the USER sees the team mate's
// saved entries on Team Day Logs, read-only — ONE-WAY (owner 2026-10-31, 0231);
// the mate sees the User only if that row is set too (day_log_team_mates). The people are the company's active users whose
// Day Log is not hidden (GET /day-logs/team-mates/people, same Super Admin
// check as the tab), shown "Name — Dept". Below, the chosen user's team
// mates on the FIT table (ADR-199): Sr No · Team Mate · Dept · Added On; the
// row's ⋯ holds "Remove team mate" behind a confirm. The server answers 409
// when the pair already exists / was already removed — shown inline (a failed
// Remove closes its confirm and says why on the same line).

import type { DayLogTeamMate } from '@innovic/shared';
import { useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { SearchableSelect, type SearchableOption } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import {
  useAddDayLogTeamMate,
  useDayLogAccess,
  useDayLogTeamMates,
  useDayLogTeamPeople,
  useRemoveDayLogTeamMate,
} from '../api';
import { errText, istStamp } from '../lib/format';
import '../day-log-sheet.css';

const COLUMNS: DataTableColumn<DayLogTeamMate>[] = [
  {
    id: 'srNo',
    header: 'Sr No',
    kind: 'code',
    className: 'mono',
    filterable: false,
    render: (_r, i) => i + 1,
  },
  {
    id: 'mate',
    header: 'Team Mate',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    className: 'fw-700',
    title: (r) => r.mateName,
    filterValue: (r) => r.mateName,
    render: (r) => r.mateName,
  },
  {
    id: 'dept',
    header: 'Dept',
    kind: 'text',
    filterValue: (r) => r.mateDeptLabel ?? '',
    render: (r) => r.mateDeptLabel ?? '—',
  },
  {
    id: 'addedOn',
    header: 'Added On',
    kind: 'date',
    className: 'mono',
    filterValue: (r) => r.addedAt,
    render: (r) => istStamp(r.addedAt).date,
  },
];

type Msg = { tone: 'ok' | 'err'; text: string } | null;

export function TeamsConfig(): React.JSX.Element {
  const access = useDayLogAccess();
  const canManage = Boolean(access.data?.canManageTeams);
  const people = useDayLogTeamPeople(canManage);
  const [userId, setUserId] = useState<string | null>(null);
  const [mateId, setMateId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [removing, setRemoving] = useState<DayLogTeamMate | null>(null);
  const mates = useDayLogTeamMates(canManage ? userId : null);
  const saveKey = useSaveKey();
  const add = useAddDayLogTeamMate(saveKey);
  const remove = useRemoveDayLogTeamMate();

  if (!access.data) {
    return access.isError ? (
      <PageState state="error" message={errText(access.error, 'Could not load your access.')} />
    ) : (
      <PageState state="loading" />
    );
  }
  if (!canManage) {
    return <PageState state="noaccess" message="Teams Config is for a Super Admin only." />;
  }
  if (!people.data) {
    return people.isError ? (
      <PageState state="error" message={errText(people.error, 'Could not load the people.')} />
    ) : (
      <PageState state="loading" />
    );
  }

  const everyone: SearchableOption[] = people.data.rows.map((u) => ({
    id: u.id,
    name: u.deptLabel ? `${u.name} — ${u.deptLabel}` : u.name,
  }));
  const plain = new Map(people.data.rows.map((u) => [u.id, u.name]));
  const nameOf = (id: string | null): string => (id ? (plain.get(id) ?? '') : '');
  const rows = mates.data?.userId === userId ? mates.data.rows : [];
  const taken = new Set(rows.map((r) => r.mateId));
  const mateOptions = everyone.filter((p) => p.id !== userId && !taken.has(p.id));
  const userName = nameOf(userId);
  const matesReady = Boolean(userId) && mates.isSuccess && !mates.isFetching;

  const onAdd = (): void => {
    if (!userId || !mateId || add.isPending) return;
    const mateName = nameOf(mateId);
    setMsg(null);
    add.mutate(
      { userId, mateId },
      {
        onSuccess: () => {
          setMateId(null);
          setMsg({
            tone: 'ok',
            text: `${mateName} added. ${userName} can now see ${mateName}'s Day Log.`,
          });
        },
        onError: (e) => setMsg({ tone: 'err', text: errText(e) }),
      },
    );
  };

  return (
    <div>
      <div className="dl-addbar" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div>
          <label className="form-label" htmlFor="dl-teams-user">
            User <span className="req">*</span>
          </label>
          <SearchableSelect
            id="dl-teams-user"
            style={{ width: 320, maxWidth: '100%' }}
            value={userId}
            options={everyone}
            placeholder="Type user name or dept…"
            onChange={(id) => {
              // A new pair is a new save: a key kept after a timeout must
              // never replay the old pair for this one (ADR-172).
              saveKey.rotate();
              setUserId(id);
              setMateId(null);
              setMsg(null);
            }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="dl-teams-mate">
            Add team mate
          </label>
          <SearchableSelect
            id="dl-teams-mate"
            style={{ width: 320, maxWidth: '100%' }}
            value={mateId}
            options={mateOptions}
            disabled={!userId || !matesReady}
            placeholder={userId ? 'Type user name or dept…' : 'Pick a User first'}
            emptyText="No matches (people already added are not listed)"
            onChange={(id) => {
              saveKey.rotate();
              setMateId(id);
              setMsg(null);
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!userId || !mateId || !matesReady || add.isPending}
          onClick={onAdd}
        >
          {add.isPending ? 'Adding…' : '+ Add'}
        </button>
      </div>
      {msg ? (
        <p
          role={msg.tone === 'err' ? 'alert' : 'status'}
          style={{
            color: msg.tone === 'err' ? 'var(--red2)' : 'var(--green2)',
            fontWeight: 600,
            fontSize: 13,
            margin: '0 0 10px',
          }}
        >
          {msg.text}
        </p>
      ) : null}
      {!userId ? (
        <PageState message="Pick a User to see and set their team mates." />
      ) : mates.isError ? (
        <PageState state="error" message={errText(mates.error, 'Could not load the team mates.')} />
      ) : (
        <>
          <div className="dl-toolbar">
            <span className="fw-700">
              Team mates of {userName} · {rows.length}
            </span>
            {rows.length > 0 ? (
              <span className="text3 dl-small">
                {userName} sees these people&apos;s saved Day Log entries, read-only.
              </span>
            ) : null}
          </div>
          <DataTable<DayLogTeamMate>
            tableKey={TABLE_KEYS.dayLogTeamMates}
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            loading={mates.isLoading}
            empty={`No team mates yet — ${userName} sees only their own Day Log.`}
            rowMenuLabel={(r) => `Actions for ${r.mateName}`}
            rowMenu={(r) => [
              {
                key: 'remove',
                label: 'Remove team mate',
                icon: 'trash-2',
                group: 'danger',
                disabledReason: remove.isPending ? 'Working…' : undefined,
                onSelect: () => setRemoving(r),
              },
            ]}
          />
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove team mate?"
        message={
          removing
            ? `${userName} will no longer see ${removing.mateName}'s Day Log. Their entries are not touched.`
            : ''
        }
        cancelLabel="Keep"
        confirmLabel="Remove"
        pendingLabel="Removing…"
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const pair = removing;
          // Removed or refused (409 "already removed"…): the confirm closes
          // either way, the list re-reads (api.ts) and the line says why.
          try {
            await remove.mutateAsync(pair.id);
            setMsg(null);
          } catch (e) {
            setMsg({ tone: 'err', text: errText(e) });
          } finally {
            setRemoving(null);
          }
        }}
      />
    </div>
  );
}
