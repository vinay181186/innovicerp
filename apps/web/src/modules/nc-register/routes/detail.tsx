import type { NcRegister } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useNcRegister, useSoftDeleteNcRegister } from '../api';
import { NcDispositionBadge } from '../components/nc-disposition-badge';
import { NcStatusBadge } from '../components/nc-status-badge';

export const ncRegisterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/$id',
  component: NcRegisterDetailPage,
});

function NcRegisterDetailPage() {
  const { id } = ncRegisterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useNcRegister(id);
  const softDelete = useSoftDeleteNcRegister();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <main className="container max-w-4xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading NC…
        </div>
      </main>
    );
  }
  if (isError || !detail) {
    return (
      <main className="container max-w-4xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>NC not found</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : 'This NC could not be loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/nc-register">
                <ArrowLeft />
                Back to NC register
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const isPending = detail.status === 'pending';
  const onDelete = () => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/nc-register', replace: true });
      },
    });
  };

  return (
    <main className="container max-w-4xl py-10">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/nc-register">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              disabled={!isPending}
              title={!isPending ? 'Cannot edit disposed/closed NCs' : undefined}
            >
              <Link to="/nc-register/$id/edit" params={{ id: detail.id }}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this NC?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={softDelete.isPending}
                >
                  {softDelete.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={softDelete.isPending}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={!isPending}
                title={!isPending ? 'Disposed/closed NCs are permanent' : undefined}
              >
                <Trash2 />
                Delete
              </Button>
            )}
          </div>
        </div>

        {softDelete.isError ? (
          <p className="text-sm text-destructive">
            {softDelete.error instanceof Error
              ? softDelete.error.message
              : 'Failed to delete NC.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription className="font-mono">{detail.code}</CardDescription>
            <CardTitle className="flex items-center gap-3">
              {detail.itemNameText ?? detail.itemCodeText ?? 'Untitled item'}
              <NcStatusBadge status={detail.status} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid detail={detail} />
          </CardContent>
        </Card>

        {detail.disposition || detail.dispositionDate ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Disposition</CardTitle>
              <CardDescription>
                Set during the disposition workflow (T-040b owns the cascade logic).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DispositionGrid detail={detail} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function DetailGrid(props: { detail: NcRegister }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <Pair label="NC date" value={detail.ncDate} />
      <Pair label="Item code" value={detail.itemCodeText} />
      <Pair label="Item name" value={detail.itemNameText ?? '—'} />
      <Pair label="Job card" value={detail.jobCardId ? '— linked —' : '—'} />
      <Pair label="Op seq" value={detail.opSeq != null ? String(detail.opSeq) : '—'} />
      <Pair
        label="Operation"
        value={detail.operationText ?? detail.qcOperationText ?? '—'}
      />
      <Pair label="Machine" value={detail.machineCodeText ?? '—'} />
      <Pair label="SO No." value={detail.soCodeText ?? '—'} />
      <Pair
        label="Rejected qty"
        value={Number(detail.rejectedQty).toFixed(2)}
      />
      <Pair
        label="Reason category"
        value={detail.reasonCategory.replaceAll('_', ' ')}
      />
      <Pair label="Reported by" value={detail.reportedByText ?? '—'} />
      <Pair label="Time logged" value={detail.timeLogged ?? '—'} />
      <div className="md:col-span-3">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
          Defect description
        </dt>
        <dd className="mt-1 whitespace-pre-wrap">{detail.reason ?? '—'}</dd>
      </div>
    </dl>
  );
}

function DispositionGrid(props: { detail: NcRegister }) {
  const { detail } = props;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Action</dt>
        <dd className="mt-1">
          <NcDispositionBadge disposition={detail.disposition} />
        </dd>
      </div>
      <Pair label="Disposed on" value={detail.dispositionDate ?? '—'} />
      <Pair label="Disposed by" value={detail.dispositionByText ?? '—'} />
      <Pair label="Rework JC" value={detail.reworkJcCodeText ?? '—'} />
      <Pair
        label="Rework op"
        value={detail.reworkOpSeq != null ? String(detail.reworkOpSeq) : '—'}
      />
      <Pair
        label="Rework done qty"
        value={detail.reworkDoneQty ? Number(detail.reworkDoneQty).toFixed(2) : '—'}
      />
      <Pair
        label="Scrap cost"
        value={Number(detail.scrapCost) > 0 ? `₹${Number(detail.scrapCost).toFixed(2)}` : '—'}
      />
      <div className="md:col-span-3">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
          Disposition remarks
        </dt>
        <dd className="mt-1 whitespace-pre-wrap">{detail.dispositionRemarks ?? '—'}</dd>
      </div>
    </dl>
  );
}

function Pair(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 font-medium">{props.value}</dd>
    </div>
  );
}
