// Settings page — Phase A item 5b. Edits the caller's own company row.
// Replaces the Firebase-specific legacy renderSettings L13351 with the
// fields that map to our `companies` table. Admin-only writes.

import type { UpdateCompanyInput } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { signOut, useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany, useUpdateMyCompany } from '../api';
import { DataIntegrityPanel } from '../components/data-integrity-panel';
import { OspProcessesPanel } from '../components/osp-processes-panel';

export const settingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'settings',
  component: SettingsPage,
});

interface FormValues {
  name: string;
  gstNumber: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
}

function SettingsPage(): React.JSX.Element {
  const { data: me } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const { data: company, isLoading, isError, error } = useMyCompany();
  const update = useUpdateMyCompany();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);

  const isAdmin = me?.role === 'admin';

  const { register, handleSubmit, formState, reset } = useForm<FormValues>({
    defaultValues: {
      name: '',
      gstNumber: '',
      phone: '',
      email: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      pincode: '',
    },
  });

  useEffect(() => {
    if (!company) return;
    reset({
      name: company.name,
      gstNumber: company.gstNumber ?? '',
      phone: company.phone ?? '',
      email: company.email ?? '',
      addressLine1: company.addressLine1 ?? '',
      addressLine2: company.addressLine2 ?? '',
      city: company.city ?? '',
      state: company.state ?? '',
      pincode: company.pincode ?? '',
    });
  }, [company, reset]);

  const onValid = async (values: FormValues): Promise<void> => {
    setSubmitError(null);
    setSubmitOk(false);
    const payload: UpdateCompanyInput = {
      name: values.name.trim() || undefined,
      gstNumber: values.gstNumber.trim() || undefined,
      phone: values.phone.trim() || undefined,
      email: values.email.trim() || undefined,
      addressLine1: values.addressLine1.trim() || undefined,
      addressLine2: values.addressLine2.trim() || undefined,
      city: values.city.trim() || undefined,
      state: values.state.trim() || undefined,
      pincode: values.pincode.trim() || undefined,
    };
    try {
      await update.mutateAsync(payload);
      setSubmitOk(true);
      window.setTimeout(() => setSubmitOk(false), 3000);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save changes.');
    }
  };

  return (
    <div>
      {/* Legacy L13355–13365 puts the signed-in-user card ABOVE the section header. */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div
          className="panel-body"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            {/* Legacy L13357 shows cu.name here; MeResponse has no name, so email is the identity. */}
            <div className="fw-700" style={{ fontSize: 14 }}>
              {me?.email ?? 'Guest'}
            </div>
            <div className="text3" style={{ fontSize: 11 }}>
              {me?.role ?? 'unknown'} access
              {me?.companyId ? (
                <>
                  {' '}
                  · company <span className="mono">{me.companyId.slice(0, 8)}…</span>
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={async () => {
                setSigningOut(true);
                try {
                  await signOut();
                } finally {
                  setSigningOut(false);
                }
              }}
              disabled={signingOut}
            >
              {signingOut ? <Loader2 size={13} className="animate-spin" /> : null}
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="section-hdr">Settings</div>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <span className="panel-title">🏢 Company info</span>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              {isAdmin
                ? 'Editable by admins. Used on printed documents (SO / JC / PO / DC / Invoice headers).'
                : '⛔ Admin access required to edit. Contact your admin if details are wrong.'}
            </div>
          </div>
        </div>
        <div className="panel-body">
          {isLoading ? (
            <div>
              <Loader2 className="inline h-4 w-4 animate-spin" /> Loading company…
            </div>
          ) : isError || !company ? (
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load company.'}
            </div>
          ) : (
            <form onSubmit={handleSubmit(onValid)}>
              <fieldset disabled={!isAdmin} style={{ border: 'none', padding: 0, margin: 0 }}>
                <div className="form-grid form-grid-3">
                  <div className="form-grp form-full">
                    <label className="form-label" htmlFor="name">
                      Company name<span className="req">★</span>
                    </label>
                    <input
                      id="name"
                      className="innovic-input fw-700"
                      autoComplete="off"
                      {...register('name', {
                        required: 'Name is required',
                        maxLength: { value: 255, message: 'Max 255 chars' },
                      })}
                    />
                    {formState.errors.name?.message ? (
                      <div className="form-error">{formState.errors.name.message}</div>
                    ) : null}
                  </div>
                  <div className="form-grp">
                    <label className="form-label" htmlFor="gstNumber">
                      GST number
                    </label>
                    <input
                      id="gstNumber"
                      className="innovic-input mono"
                      autoComplete="off"
                      placeholder="27AAAAA0000A1Z5"
                      {...register('gstNumber', {
                        maxLength: { value: 32, message: 'Max 32 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label" htmlFor="phone">
                      Phone
                    </label>
                    <input
                      id="phone"
                      className="innovic-input"
                      autoComplete="off"
                      placeholder="+91-..."
                      {...register('phone', {
                        maxLength: { value: 32, message: 'Max 32 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label" htmlFor="email">
                      E-mail
                    </label>
                    <input
                      id="email"
                      className="innovic-input"
                      type="email"
                      autoComplete="off"
                      placeholder="company@domain.com"
                      {...register('email', {
                        maxLength: { value: 255, message: 'Max 255 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp form-full">
                    <label className="form-label" htmlFor="addressLine1">
                      Address line 1
                    </label>
                    <input
                      id="addressLine1"
                      className="innovic-input"
                      autoComplete="off"
                      placeholder="Plot / Survey No / Street"
                      {...register('addressLine1', {
                        maxLength: { value: 255, message: 'Max 255 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp form-full">
                    <label className="form-label" htmlFor="addressLine2">
                      Address line 2
                    </label>
                    <input
                      id="addressLine2"
                      className="innovic-input"
                      autoComplete="off"
                      placeholder="Industrial estate / Area"
                      {...register('addressLine2', {
                        maxLength: { value: 255, message: 'Max 255 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label" htmlFor="city">
                      City
                    </label>
                    <input
                      id="city"
                      className="innovic-input"
                      autoComplete="off"
                      {...register('city', {
                        maxLength: { value: 64, message: 'Max 64 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label" htmlFor="state">
                      State
                    </label>
                    <input
                      id="state"
                      className="innovic-input"
                      autoComplete="off"
                      placeholder="MH / GJ / KA …"
                      {...register('state', {
                        maxLength: { value: 64, message: 'Max 64 chars' },
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label" htmlFor="pincode">
                      PIN code
                    </label>
                    <input
                      id="pincode"
                      className="innovic-input mono"
                      autoComplete="off"
                      placeholder="411001"
                      {...register('pincode', {
                        maxLength: { value: 16, message: 'Max 16 chars' },
                      })}
                    />
                  </div>
                </div>

                {isAdmin ? (
                  <div style={{ marginTop: 16 }}>
                    {submitError ? (
                      <div
                        style={{
                          color: 'var(--red)',
                          background: 'var(--red3)',
                          border: '1px solid #fca5a5',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: 12,
                          marginBottom: 10,
                        }}
                      >
                        {submitError}
                      </div>
                    ) : null}
                    {submitOk ? (
                      <div
                        style={{
                          color: 'var(--green2)',
                          background: 'rgba(34,197,94,0.08)',
                          border: '1px solid #86efac',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: 12,
                          marginBottom: 10,
                        }}
                      >
                        ✓ Company details saved.
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={formState.isSubmitting || update.isPending}
                      >
                        {formState.isSubmitting || update.isPending ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : null}
                        Save changes
                      </button>
                    </div>
                  </div>
                ) : null}
              </fieldset>
            </form>
          )}
        </div>
      </div>

      <OspProcessesPanel />
      <DataIntegrityPanel />
    </div>
  );
}
