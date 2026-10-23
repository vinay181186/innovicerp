// ADR-250 — the ⏰ Remind symbol: a task to the person holding the next step,
// linked to the document, through the tasks module's existing create
// (POST /tasks). One Idempotency-Key per symbol, reused until the server
// answers (useSaveKey), plus an in-flight guard: a double click makes ONE task.

import type { DashAction } from '@innovic/shared';
import { useRef, useState } from 'react';
import { todayIst } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { useCreateTask } from '@/modules/tasks/api';
import { useToast } from '@/ui/feedback';

type TaskFor = NonNullable<DashAction['taskFor']>;

export function useRemind(): { busy: boolean; send: (t: TaskFor, label: string) => void } {
  const saveKey = useSaveKey();
  const create = useCreateTask(saveKey);
  const toast = useToast();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const send = (t: TaskFor, label: string): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    create
      .mutateAsync({
        title: `Reminder: ${t.linkedRefDisplay}`,
        assignedTo: t.userId,
        priority: 'medium',
        dueDate: todayIst(),
        linkedRef: {
          type: t.linkedRefType,
          id: t.linkedRefId,
          display: t.linkedRefDisplay,
          navPage: t.linkedRefNavPage,
        },
      })
      .then(
        () => toast.ok(`${label} — reminder sent`),
        (e: unknown) =>
          toast.error(e instanceof Error ? e.message : 'Could not send the reminder.'),
      )
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  return { busy, send };
}
