// Register one instrument piece (ADR-193 phase 4a). Registering never moves
// stock — it names a piece already received (GRN / Stock Count), so the server
// refuses (409) once every received piece of the item is registered, and
// refuses a Instrument Serial No. already used on the item (case-insensitive).
import type { CreateInstrumentInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDaysLocal } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { SearchableSelect } from '@/ui/forms';
import { useItemsList } from '../../items/api';
import { useCreateInstrument } from '../api';
import { errText } from '../lib/instrument-ui';

export interface RegisterSeed {
  itemId: string;
  itemCode: string;
}

export function RegisterInstrumentModal({
  seed,
  onClose,
}: {
  seed: RegisterSeed | null;
  onClose: () => void;
}): React.JSX.Element {
  const [itemId, setItemId] = useState<string | null>(seed?.itemId ?? null);
  const [search, setSearch] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const [lastOn, setLastOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  // Calibration Due fills itself from Last Calibrated + interval until the user
  // types their own date.
  const [dueTouched, setDueTouched] = useState(false);
  const [location, setLocation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // One save key per modal open (the list mounts it only while open).
  const saveKey = useSaveKey();
  const create = useCreateInstrument(saveKey);

  const { data, isFetching } = useItemsList({
    search: search.trim() || undefined,
    itemType: 'tool',
    limit: 30,
    offset: 0,
  });
  // Only serial-tracked tools carry a register (bulk tools are counted by qty).
  const options = useMemo(
    () =>
      (data?.items ?? [])
        .filter((it) => it.trackSerial !== false)
        .map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [data],
  );

  const autoDue = (last: string, days: string): void => {
    if (dueTouched) return;
    const n = Number(days);
    setDueOn(last && Number.isInteger(n) && n > 0 ? addDaysLocal(last, n) : '');
  };

  const save = (): void => {
    setErr(null);
    if (!itemId) return setErr('Choose the Tool / Instrument item.');
    if (!serialNo.trim()) return setErr('Enter the Instrument Serial No.');
    let days: number | null = null;
    if (intervalDays.trim()) {
      days = Number(intervalDays);
      if (!Number.isInteger(days) || days <= 0 || days > 3650)
        return setErr('Calibration Interval (days) must be a whole number from 1 to 3650.');
    }
    const input: CreateInstrumentInput = {
      itemId,
      serialNo: serialNo.trim(),
      calibrationIntervalDays: days,
      ...(lastOn ? { lastCalibratedOn: lastOn } : {}),
      ...(dueOn ? { calibrationDueOn: dueOn } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    create.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(errText(e, 'Could not register the instrument. Try again.')),
    });
  };

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 680, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">Register Instrument</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="text3" style={{ fontSize: 11, marginBottom: 10 }}>
            Registering does not move stock — the piece must already be received by GRN or Stock
            Count.
          </div>
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="ins-item">
                Item ★
              </label>
              <SearchableSelect
                id="ins-item"
                value={itemId}
                valueLabel={seed?.itemCode}
                onChange={setItemId}
                options={options}
                onSearch={setSearch}
                loading={isFetching}
                placeholder="🔍 Tool / Instrument item code or name…"
                emptyText="No serial-tracked Tool / Instrument item"
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ins-serial">
                Instrument Serial No. ★
              </label>
              <input
                id="ins-serial"
                className="innovic-input mono fw-700"
                autoComplete="off"
                maxLength={80}
                value={serialNo}
                onChange={(e) => setSerialNo(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ins-interval">
                Calibration Interval (days)
              </label>
              <input
                id="ins-interval"
                type="number"
                min={1}
                max={3650}
                step={1}
                className="innovic-input mono"
                placeholder="blank = not calibrated"
                value={intervalDays}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => {
                  setIntervalDays(e.target.value);
                  autoDue(lastOn, e.target.value);
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ins-last">
                Last Calibrated
              </label>
              <input
                id="ins-last"
                type="date"
                className="innovic-input"
                value={lastOn}
                onChange={(e) => {
                  setLastOn(e.target.value);
                  autoDue(e.target.value, intervalDays);
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ins-due">
                Calibration Due
              </label>
              <input
                id="ins-due"
                type="date"
                className="innovic-input"
                value={dueOn}
                onChange={(e) => {
                  setDueTouched(true);
                  setDueOn(e.target.value);
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ins-loc">
                Location
              </label>
              <input
                id="ins-loc"
                className="innovic-input"
                maxLength={100}
                placeholder="e.g. QC cabinet 2"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="ins-rem">
                Remarks
              </label>
              <input
                id="ins-rem"
                className="innovic-input"
                maxLength={500}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={save}
          >
            {create.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Register'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
