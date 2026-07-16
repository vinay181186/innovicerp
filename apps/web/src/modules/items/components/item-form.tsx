// Item create + edit form (UI-003-01).
// Ported against legacy itemForm / addItem / editItem
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L11523, L11598,
// L11609). Field order mirrors legacy exactly: Code, Name, Description (full),
// Drawing No., Revision, Material, UOM, Drawing File (full, last).
// Item Type + HSN Code have no legacy counterpart but exist in our schema and
// are kept — placed after UOM so legacy's relative order is untouched.
// Footer chrome mirrors legacy showModal (L28015): Cancel (ghost) + Save
// (primary) in a .modal-footer.

import {
  type CreateItemInput,
  type Item,
  ITEM_TYPES,
  type UpdateItemInput,
  UOMS,
  createItemInputSchema,
  updateItemInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { DrawingUploadField } from './drawing-upload-field';

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateItemInput>;
  onSubmit: (values: CreateItemInput) => Promise<void> | void;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  item: Item;
  onSubmit: (values: UpdateItemInput) => Promise<void> | void;
  submitError?: string | null;
  onCancel?: () => void;
};

type ItemFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateItemInput = {
  code: '',
  name: '',
  description: undefined,
  drawingNo: undefined,
  revision: 'A',
  material: undefined,
  uom: 'NOS',
  itemType: 'component',
  hsnCode: undefined,
  drawingFilePath: undefined,
};

function itemToUpdateDefaults(item: Item): UpdateItemInput {
  return {
    name: item.name,
    description: item.description ?? undefined,
    drawingNo: item.drawingNo ?? undefined,
    revision: item.revision,
    material: item.material ?? undefined,
    uom: item.uom,
    itemType: item.itemType,
    hsnCode: item.hsnCode ?? undefined,
    drawingFilePath: item.drawingFilePath ?? undefined,
  };
}

export function ItemForm(props: ItemFormProps): React.JSX.Element {
  if (props.mode === 'create') return <CreateItemForm {...props} />;
  return <EditItemForm {...props} />;
}

function CreateItemForm(props: CreateMode): React.JSX.Element {
  const form = useForm<CreateItemInput>({
    resolver: zodResolver(createItemInputSchema),
    defaultValues: { ...CREATE_DEFAULTS, ...props.defaultValues },
  });
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <div className="panel-body">
        <div className="form-grid">
          <div className="form-grp">
            <label className="form-label" htmlFor="code">
              Item Code<span className="req">★</span>
            </label>
            <input
              id="code"
              className="innovic-input"
              autoFocus
              autoComplete="off"
              placeholder="e.g. ITM-001"
              {...register('code')}
            />
            {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="name">
              Item Name<span className="req">★</span>
            </label>
            <input
              id="name"
              className="innovic-input"
              autoComplete="off"
              placeholder="Full part name"
              {...register('name')}
            />
            {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
          </div>

          <div className="form-grp form-full">
            <label className="form-label" htmlFor="description">
              Description
            </label>
            <input
              id="description"
              className="innovic-input"
              autoComplete="off"
              placeholder="Short description"
              {...register('description')}
            />
            {errors.description?.message ? (
              <div className="form-error">{errors.description.message}</div>
            ) : null}
          </div>

          <div className="form-grp">
            <label className="form-label" htmlFor="drawingNo">
              Drawing No.
            </label>
            <input
              id="drawingNo"
              className="innovic-input"
              autoComplete="off"
              placeholder="DRG-001"
              {...register('drawingNo')}
            />
            {errors.drawingNo?.message ? (
              <div className="form-error">{errors.drawingNo.message}</div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="revision">
              Revision
            </label>
            <input
              id="revision"
              className="innovic-input"
              autoComplete="off"
              placeholder="A"
              {...register('revision')}
            />
            {errors.revision?.message ? (
              <div className="form-error">{errors.revision.message}</div>
            ) : null}
          </div>

          <div className="form-grp">
            <label className="form-label" htmlFor="material">
              Material
            </label>
            <input
              id="material"
              className="innovic-input"
              autoComplete="off"
              placeholder="EN8, SS304..."
              {...register('material')}
            />
            {errors.material?.message ? (
              <div className="form-error">{errors.material.message}</div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="uom">
              UOM
            </label>
            <select id="uom" className="innovic-select" {...register('uom')}>
              {UOMS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {errors.uom?.message ? <div className="form-error">{errors.uom.message}</div> : null}
          </div>

          <div className="form-grp">
            <label className="form-label" htmlFor="itemType">
              Item Type
            </label>
            <select id="itemType" className="innovic-select" {...register('itemType')}>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {errors.itemType?.message ? (
              <div className="form-error">{errors.itemType.message}</div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="hsnCode">
              HSN Code
            </label>
            <input id="hsnCode" className="innovic-input" autoComplete="off" {...register('hsnCode')} />
            {errors.hsnCode?.message ? (
              <div className="form-error">{errors.hsnCode.message}</div>
            ) : null}
          </div>

          <DrawingUploadField
            value={watch('drawingFilePath')}
            onChange={(p) => setValue('drawingFilePath', p, { shouldDirty: true })}
          />
        </div>

        {props.submitError ? <div className="form-error">{props.submitError}</div> : null}
      </div>

      <FormFooter isSubmitting={formState.isSubmitting} onCancel={props.onCancel} />
    </form>
  );
}

function EditItemForm(props: EditMode): React.JSX.Element {
  const form = useForm<UpdateItemInput>({
    resolver: zodResolver(updateItemInputSchema),
    defaultValues: itemToUpdateDefaults(props.item),
  });
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <div className="panel-body">
        <div className="form-grid">
          <div className="form-grp">
            <label className="form-label" htmlFor="code">
              Item Code<span className="req">★</span>
            </label>
            <input
              id="code"
              className="innovic-input"
              value={props.item.code}
              placeholder="e.g. ITM-001"
              readOnly
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="name">
              Item Name<span className="req">★</span>
            </label>
            <input
              id="name"
              className="innovic-input"
              autoComplete="off"
              placeholder="Full part name"
              {...register('name')}
            />
            {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
          </div>

          <div className="form-grp form-full">
            <label className="form-label" htmlFor="description">
              Description
            </label>
            <input
              id="description"
              className="innovic-input"
              autoComplete="off"
              placeholder="Short description"
              {...register('description')}
            />
            {errors.description?.message ? (
              <div className="form-error">{errors.description.message}</div>
            ) : null}
          </div>

          <div className="form-grp">
            <label className="form-label" htmlFor="drawingNo">
              Drawing No.
            </label>
            <input
              id="drawingNo"
              className="innovic-input"
              autoComplete="off"
              placeholder="DRG-001"
              {...register('drawingNo')}
            />
            {errors.drawingNo?.message ? (
              <div className="form-error">{errors.drawingNo.message}</div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="revision">
              Revision
            </label>
            <input
              id="revision"
              className="innovic-input"
              autoComplete="off"
              placeholder="A"
              {...register('revision')}
            />
            {errors.revision?.message ? (
              <div className="form-error">{errors.revision.message}</div>
            ) : null}
          </div>

          <div className="form-grp">
            <label className="form-label" htmlFor="material">
              Material
            </label>
            <input
              id="material"
              className="innovic-input"
              autoComplete="off"
              placeholder="EN8, SS304..."
              {...register('material')}
            />
            {errors.material?.message ? (
              <div className="form-error">{errors.material.message}</div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="uom">
              UOM
            </label>
            <select id="uom" className="innovic-select" {...register('uom')}>
              {UOMS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {errors.uom?.message ? <div className="form-error">{errors.uom.message}</div> : null}
          </div>

          <div className="form-grp">
            <label className="form-label" htmlFor="itemType">
              Item Type
            </label>
            <select id="itemType" className="innovic-select" {...register('itemType')}>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {errors.itemType?.message ? (
              <div className="form-error">{errors.itemType.message}</div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="hsnCode">
              HSN Code
            </label>
            <input id="hsnCode" className="innovic-input" autoComplete="off" {...register('hsnCode')} />
            {errors.hsnCode?.message ? (
              <div className="form-error">{errors.hsnCode.message}</div>
            ) : null}
          </div>

          <DrawingUploadField
            value={watch('drawingFilePath')}
            onChange={(p) => setValue('drawingFilePath', p, { shouldDirty: true })}
          />
        </div>

        {props.submitError ? <div className="form-error">{props.submitError}</div> : null}
      </div>

      <FormFooter isSubmitting={formState.isSubmitting} onCancel={props.onCancel} />
    </form>
  );
}

// Mirrors legacy showModal's footer (L28025-28028): Cancel (ghost) then Save
// (primary). Legacy uses the same "Save" label for both Add and Edit.
function FormFooter(props: {
  isSubmitting: boolean;
  onCancel?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <div className="modal-footer">
      {props.onCancel ? (
        <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
          Cancel
        </button>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={props.isSubmitting}>
        {props.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
        Save
      </button>
    </div>
  );
}
