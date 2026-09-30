// Master rules (plan v3 Step 2) — the company switches for the GSTIN / State /
// GST Category rule on Customers and Vendors and the HSN Code rule on Items.
// Stored on the company row (migration 0183) and read by the API on every
// Customer / Vendor / Item save, and by those forms for their live warnings.
//
// Admin-only, same as Company Info above it: everyone else sees the settings
// read-only. The API's PATCH /companies/me is admin-gated as well.

import {
  HSN_MIN_DIGITS_OPTIONS,
  MASTER_RULES_MODES,
  MASTER_RULES_MODE_LABEL,
  type MasterRulesMode,
  type UpdateCompanyInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Banner } from '@/ui/feedback';
import { useMyCompany, useUpdateMyCompany } from '../api';
import { useMasterRuleSettings } from '../master-rules-ui';

export function MasterRulesPanel(props: { isAdmin: boolean }): React.JSX.Element | null {
  const { data: company } = useMyCompany();
  const current = useMasterRuleSettings();
  const update = useUpdateMyCompany();
  const [mode, setMode] = useState<MasterRulesMode>(current.masterRulesMode);
  const [checkHsn, setCheckHsn] = useState(current.checkHsn);
  const [hsnMinDigits, setHsnMinDigits] = useState<number>(current.hsnMinDigits);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);

  // Load (and re-load after a save) from the company row.
  useEffect(() => {
    setMode(current.masterRulesMode);
    setCheckHsn(current.checkHsn);
    setHsnMinDigits(current.hsnMinDigits);
  }, [current.masterRulesMode, current.checkHsn, current.hsnMinDigits]);

  if (!company) return null;

  const dirty =
    mode !== current.masterRulesMode ||
    checkHsn !== current.checkHsn ||
    hsnMinDigits !== current.hsnMinDigits;

  const onSave = async (): Promise<void> => {
    setSubmitError(null);
    setSubmitOk(false);
    const payload: UpdateCompanyInput = {
      masterRulesMode: mode,
      checkHsn,
      hsnMinDigits: hsnMinDigits as UpdateCompanyInput['hsnMinDigits'],
    };
    try {
      await update.mutateAsync(payload);
      setSubmitOk(true);
      window.setTimeout(() => setSubmitOk(false), 3000);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save master rules. Try again.');
    }
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr">
        <div>
          <span className="panel-title">Master Rules</span>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            {props.isAdmin
              ? 'GSTIN, State and HSN Code checks on Customers, Vendors and Items.'
              : 'You do not have permission to edit master rules. Ask an admin.'}
          </div>
        </div>
      </div>
      <div className="panel-body">
        <fieldset disabled={!props.isAdmin} style={{ border: 'none', padding: 0, margin: 0 }}>
          <div className="form-grid form-grid-3">
            <div className="form-grp">
              <label className="form-label" htmlFor="masterRulesMode">
                Master Rules Mode
              </label>
              <select
                id="masterRulesMode"
                className="innovic-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as MasterRulesMode)}
              >
                {MASTER_RULES_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MASTER_RULES_MODE_LABEL[m]}
                  </option>
                ))}
              </select>
              <div className="form-help">
                Warn: GSTIN / State / HSN problems are shown but records save. Enforce: records with
                a problem are refused. Switch to Enforce after the data fill.
              </div>
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="checkHsn">
                Check HSN
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                htmlFor="checkHsn"
              >
                <input
                  id="checkHsn"
                  type="checkbox"
                  checked={checkHsn}
                  onChange={(e) => setCheckHsn(e.target.checked)}
                />
                <span>{checkHsn ? 'On' : 'Off'}</span>
              </label>
              <div className="form-help">
                Check HSN: items we sell (Component, Assembly) must have an HSN Code.
              </div>
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="hsnMinDigits">
                HSN Min Digits
              </label>
              <select
                id="hsnMinDigits"
                className="innovic-select"
                value={hsnMinDigits}
                onChange={(e) => setHsnMinDigits(Number(e.target.value))}
              >
                {HSN_MIN_DIGITS_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {props.isAdmin ? (
            <div style={{ marginTop: 16 }}>
              {submitError ? (
                <div style={{ marginBottom: 10 }}>
                  <Banner tone="error" role="alert">
                    {submitError}
                  </Banner>
                </div>
              ) : null}
              {submitOk ? (
                <div style={{ marginBottom: 10 }}>
                  <Banner tone="success">Master rules saved.</Banner>
                </div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!dirty || update.isPending}
                  onClick={() => void onSave()}
                >
                  {update.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                  Save Master Rules
                </button>
              </div>
            </div>
          ) : null}
        </fieldset>
      </div>
    </div>
  );
}
