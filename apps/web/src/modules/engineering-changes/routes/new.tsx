// New Engineering Change (ADR-291). The server numbers it (IN-ECR-#####,
// ADR-227) and saves it as Draft; Submit on the detail page builds the impact
// list and holds the affected work. One save key per open form (ADR-172).

import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useToast } from '@/ui/feedback';
import { PageState } from '@/ui/layout';
import { useCreateEcr } from '../api';
import { EMPTY_ECR_DRAFT, EcrForm } from '../components/ecr-form';

export const ecrNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ecrs/new',
  component: EcrNewPage,
});

function EcrNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ecr_create');
  const saveKey = useSaveKey();
  const create = useCreateEcr(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/ecrs' }), [navigate]);
  // ADR-313 — the form below keeps a draft; its `clear` lands here for the guard.
  const draftClear = useRef<() => void>(() => undefined);
  const exit = useExitConfirm({
    onExit: goBack,
    draft: { band: null, clear: () => draftClear.current() },
  });
  const toast = useToast();

  if (eff && !perms.entry) {
    return (
      <PageState
        as="page"
        state="noaccess"
        message="You do not have permission to raise an Engineering Change. Ask an admin."
      />
    );
  }

  return (
    <>
      {exit.dialog}
      <EcrForm
        draftSlot={{ key: 'ecr-new', clearRef: draftClear }}
        title="New Engineering Change"
        initial={EMPTY_ECR_DRAFT}
        submitting={create.isPending}
        submitError={submitError}
        saveLabel="Save ECR"
        onCancel={() => exit.leave(goBack)}
        onSubmit={(input) => {
          setSubmitError(null);
          create
            .mutateAsync(input)
            .then((ecr) => {
              toast.ok(`${ecr.code} saved as Draft`);
              exit.leave(
                () => void navigate({ to: '/ecrs/$id', params: { id: ecr.id }, replace: true }),
              );
            })
            .catch((e: unknown) =>
              setSubmitError(e instanceof Error ? e.message : 'Could not save the ECR. Try again.'),
            );
        }}
      />
    </>
  );
}
