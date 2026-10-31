// ADR-264 — "Create to-do" on the home (inline panel). Fields per NAMING.md:
// To-do · Due Date · Assign to · Linked document. "Me" → POST /tasks/personal;
// someone else → POST /tasks (Due Date required, ADR-176). One Idempotency-Key
// per open form; Save is disabled while saving, so a double click makes one.
//
// Linked document searches every Related To type at once (GET
// /tasks/related-options per type, the Task Board's own feed) so the form
// needs no second "type" control.

import {
  TASK_RELATED_TYPES,
  TASK_RELATED_TYPE_LABELS,
  type TaskLinkedRef,
  type TaskRelatedOption,
  type TaskRelatedType,
} from '@innovic/shared';
import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { todayIst } from '@/lib/date';
import { roleLabel } from '@/lib/role-label';
import { useSaveKey } from '@/lib/use-save-key';
import { useSession } from '@/lib/session';
import { taskKeys, useTaskUserOptions } from '@/modules/tasks/api';
import { relatedNavPage } from '@/modules/tasks/lib/format';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { useCreateTodo } from '../todo-api';

const ME = 'me';

function useLinkedDocOptions(search: string, enabled: boolean) {
  const results = useQueries({
    queries: TASK_RELATED_TYPES.map((type) => ({
      queryKey: taskKeys.relatedOptions(type, search),
      queryFn: () => {
        const p = new URLSearchParams({ type });
        if (search) p.set('search', search);
        return apiFetch<{ options: TaskRelatedOption[] }>(`/tasks/related-options?${p.toString()}`);
      },
      enabled,
      staleTime: 30_000,
    })),
  });
  const loading = results.some((r) => r.isFetching);
  const error = results.every((r) => r.isError) ? results[0]?.error : undefined;
  const byId = new Map<string, { type: TaskRelatedType; opt: TaskRelatedOption }>();
  results.forEach((r, i) => {
    const type = TASK_RELATED_TYPES[i];
    if (!type) return;
    for (const opt of r.data?.options ?? []) byId.set(`${type}:${opt.id}`, { type, opt });
  });
  return { byId, loading, error };
}

export function TodoCreate({ onClose }: { onClose: () => void }): React.JSX.Element {
  const saveKey = useSaveKey();
  const create = useCreateTodo(saveKey);
  const myId = useSession().data?.id;
  const users = useTaskUserOptions();

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(todayIst());
  const [assignTo, setAssignTo] = useState<string>(ME);
  const [userTerm, setUserTerm] = useState('');
  const [docId, setDocId] = useState<string | null>(null);
  const [docLabel, setDocLabel] = useState('');
  const [docTerm, setDocTerm] = useState('');
  const [docSearched, setDocSearched] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const docs = useLinkedDocOptions(docTerm, docSearched);
  // Stable: the picker re-sends its term on open through an effect keyed on it.
  const onDocSearch = useCallback((term: string) => {
    setDocSearched(true);
    setDocTerm(term);
  }, []);

  // "Me" first, then the people who may be given a task (ADR-257).
  const userOptions = useMemo(() => {
    const t = userTerm.trim().toLowerCase();
    const people = (users.data?.options ?? [])
      .filter((u) => u.opensTaskBoard && u.id !== myId)
      .filter((u) => !t || `${u.name} ${u.role ?? ''}`.toLowerCase().includes(t))
      .map((u) => ({ id: u.id, name: u.role ? `${u.name} (${roleLabel(u.role)})` : u.name }));
    return [{ id: ME, name: 'Me' }, ...people];
  }, [users.data, userTerm, myId]);
  const assignLabel =
    assignTo === ME ? 'Me' : (userOptions.find((o) => o.id === assignTo)?.name ?? undefined);

  const docOptions = useMemo(
    () =>
      [...docs.byId.entries()].map(([id, { type, opt }]) => ({
        id,
        code: opt.code,
        name: [TASK_RELATED_TYPE_LABELS[type], opt.hint].filter(Boolean).join(' · '),
      })),
    [docs.byId],
  );

  function save(): void {
    setErr(null);
    const t = title.trim();
    if (!t) return setErr('Write what needs doing.');
    if (assignTo !== ME && !dueDate) return setErr('Due Date is required.');
    let linkedRef: TaskLinkedRef | undefined;
    if (docId) {
      const hit = docs.byId.get(docId);
      if (hit) {
        linkedRef = {
          type: hit.type,
          id: hit.opt.id,
          display: hit.opt.code,
          navPage: relatedNavPage(hit.type, hit.opt.id),
        };
      }
    }
    const done = { onSuccess: onClose, onError: (e: Error) => setErr(e.message) };
    if (assignTo === ME) {
      create.mutate(
        {
          kind: 'me',
          input: {
            title: t,
            priority: 'medium',
            ...(dueDate ? { dueDate } : {}),
            ...(linkedRef ? { linkedRef } : {}),
          },
        },
        done,
      );
    } else {
      create.mutate(
        {
          kind: 'other',
          input: {
            title: t,
            assignedTo: assignTo,
            priority: 'medium',
            dueDate,
            ...(linkedRef ? { linkedRef } : {}),
          },
        },
        done,
      );
    }
  }

  return (
    <form
      className="dh-create"
      aria-label="Create to-do"
      onSubmit={(e) => {
        e.preventDefault();
        if (!create.isPending) save();
      }}
    >
      <h3>Create to-do</h3>
      <FormGrid>
        <FormField label="To-do" required size="lg" htmlFor="dh-todo-title">
          <input
            id="dh-todo-title"
            className="innovic-input"
            value={title}
            maxLength={255}
            placeholder="What needs doing?"
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField label="Due Date" required={assignTo !== ME} size="sm" htmlFor="dh-todo-due">
          <input
            id="dh-todo-due"
            type="date"
            className="innovic-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </FormField>
        <FormField label="Assign to" size="md">
          <SearchableSelect
            value={assignTo}
            valueLabel={assignLabel}
            options={userOptions}
            onSearch={setUserTerm}
            loading={users.isFetching}
            error={users.error ?? undefined}
            ariaLabel="Assign to"
            onChange={(id) => setAssignTo(id ?? ME)}
          />
        </FormField>
        <FormField label="Linked document" size="lg">
          <SearchableSelect
            value={docId}
            valueLabel={docLabel || undefined}
            options={docOptions}
            onSearch={onDocSearch}
            loading={docs.loading}
            error={docs.error ?? undefined}
            clearable
            placeholder="JC, PO, SO, NC no.…"
            ariaLabel="Linked document"
            selectedLabel={(o) => o.code ?? o.name}
            onChange={(id) => {
              setDocId(id);
              setDocLabel(id ? (docs.byId.get(id)?.opt.code ?? '') : '');
            }}
          />
        </FormField>
      </FormGrid>
      {err ? (
        <div className="form-error" role="alert">
          {err}
        </div>
      ) : null}
      <div className="dh-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Save to-do'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={create.isPending}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
