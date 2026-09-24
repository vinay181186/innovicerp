// Item create + edit form (UI-003-01).
// Ported against legacy itemForm / addItem / editItem
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L11523, L11598,
// L11609). Field order mirrors legacy: Code, Name, Description (full),
// Material, UOM, then Product image (full, last).
// Item Type + HSN Code have no legacy counterpart but exist in our schema and
// are kept — placed after UOM so legacy's relative order is untouched.
//
// NO Drawing No., Revision or Drawing File fields (user decision 2026-09-21):
// the drawing and its revision belong to the SO / JWSO LINE, not the item, so
// the form neither shows nor sends `drawingNo`, `revision` or
// `drawingFilePath` (the server defaults `revision`). In their place the item
// carries a PRODUCT IMAGE (3D render) — `imagePath` — shown as the thumbnail
// beside code · name on every list.
//
// PHASE 4 (UI overhaul, Group 2 representative). This file is now the whole
// canonical CREATE/EDIT composition, so the ~20 thin `<XForm>` wrappers behind
// a new+edit route pair can copy it verbatim:
//
//   <form> → PageHeader (back · title · Cancel + Save)
//          → Banner (submit error)
//          → Panel → FormGrid (12-col) → FormField per field
//
// The route keeps everything that is NOT layout: data hooks, permission
// gating, the exit guard, navigation. It passes `title` / `backLabel` /
// `onBack` in and renders nothing of its own around the form.
//
// Save/Cancel moved from the old `.modal-footer` at the bottom into the page
// header (design-ref/README.md "Uniformity rule" — Create/Edit page =
// section-hdr + Save/Cancel → Panel(FormGrid)). Nothing else about them
// changed: Save is still this form's only submit button, still disabled while
// submitting; Cancel still calls the caller's `onCancel` untouched.
//
// Field widths are the 12-column `size` prop, chosen by CONTENT TYPE and then
// upsized (never downsized) so each row sums to 12, per ui/forms/FormGrid:
//   Item Code lg · Item Name lg                         = 12
//   Description full                                    = 12
//   Material lg · UOM xs · Item Type md                 = 12
//   Source lg · HSN Code lg                             = 12
//   Product image full                                  = 12

import {
  type CreateItemInput,
  ITEM_PROCUREMENT_TYPES,
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_TYPES,
  type Item,
  type UpdateItemInput,
  UOMS,
  createItemInputSchema,
  updateItemInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/ui/core';
import { Banner } from '@/ui/feedback';
import { Panel } from '@/ui/data';
import { FormField, FormGrid, Input, Select } from '@/ui/forms';
import { PageHeader } from '@/ui/layout';
import { useNextItemCode } from '../api';
import { ItemImageField } from './item-image-field';

/** What both modes take: the page chrome the route names, plus its handlers. */
type CommonProps = {
  /** Page title — "Add Item" / "Edit Item". Legacy showModal's own wording. */
  title: string;
  /** Names the list the back button returns to, never just "Back". */
  backLabel?: string;
  /**
   * Back button. Deliberately NOT wrapped in the exit guard's `leave()`: the
   * old back `<Link>` was not either, so leaving this way still asks "are you
   * sure you want to exit?".
   */
  onBack?: () => void;
  submitError?: string | null;
  /** Cancel. The route wraps this one in `exit.leave(...)`, as it always did. */
  onCancel?: () => void;
};

type CreateMode = CommonProps & {
  mode: 'create';
  defaultValues?: Partial<CreateItemInput>;
  onSubmit: (values: CreateItemInput) => Promise<void> | void;
};

type EditMode = CommonProps & {
  mode: 'edit';
  item: Item;
  onSubmit: (values: UpdateItemInput) => Promise<void> | void;
};

type ItemFormProps = CreateMode | EditMode;

// Partial: `revision` is not a form field any more — the schema default
// fills it and the server owns it (see header comment).
const CREATE_DEFAULTS: Partial<CreateItemInput> = {
  code: '',
  name: '',
  description: undefined,
  material: undefined,
  uom: 'NOS',
  itemType: 'component',
  procurementType: 'make',
  hsnCode: undefined,
  imagePath: null,
};

const PROCUREMENT_OPTIONS = ITEM_PROCUREMENT_TYPES.map((t) => ({
  value: t,
  label: ITEM_PROCUREMENT_TYPE_LABEL[t],
}));

const SOURCE_HELP =
  'Make = planned & produced (Plan → Production Order → Route Card). Buy = purchased finished (+ PR from the Planning line).';

function itemToUpdateDefaults(item: Item): UpdateItemInput {
  return {
    name: item.name,
    description: item.description ?? undefined,
    material: item.material ?? undefined,
    uom: item.uom,
    itemType: item.itemType,
    procurementType: item.procurementType,
    hsnCode: item.hsnCode ?? undefined,
    imagePath: item.imagePath ?? null,
  };
}

export function ItemForm(props: ItemFormProps): React.JSX.Element {
  if (props.mode === 'create') return <CreateItemForm {...props} />;
  return <EditItemForm {...props} />;
}

/**
 * The page band both modes share: back link, title, Cancel + Save. Save is a
 * real `type="submit"` inside the `<form>`, so Enter in any field still saves.
 */
function ItemFormHeader(props: {
  title: string;
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  isSubmitting: boolean;
}): React.JSX.Element {
  return (
    <PageHeader
      title={props.title}
      backLabel={props.backLabel ?? 'Back'}
      onBack={props.onBack}
      actions={
        <>
          {props.onCancel ? (
            <Button variant="ghost" onClick={props.onCancel}>
              Cancel
            </Button>
          ) : null}
          {/* Legacy uses the same "Save" label for Add and for Edit. */}
          <Button type="submit" variant="primary" loading={props.isSubmitting}>
            Save
          </Button>
        </>
      }
    />
  );
}

function CreateItemForm(props: CreateMode): React.JSX.Element {
  const form = useForm<CreateItemInput>({
    resolver: zodResolver(createItemInputSchema),
    defaultValues: { ...CREATE_DEFAULTS, ...props.defaultValues },
  });
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;

  // Prefill the next ITM-#### in the series (editable). The user may keep it,
  // type their own (e.g. a customer part number — still validated by the code
  // rules), or clear it to let the server auto-assign on save.
  const { data: nextCode } = useNextItemCode();
  useEffect(() => {
    if (nextCode?.code && !form.getValues('code')) {
      form.setValue('code', nextCode.code);
    }
  }, [nextCode, form]);

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <ItemFormHeader
        title={props.title}
        backLabel={props.backLabel}
        onBack={props.onBack}
        onCancel={props.onCancel}
        isSubmitting={formState.isSubmitting}
      />

      {props.submitError ? (
        <Banner tone="error" role="alert">
          {props.submitError}
        </Banner>
      ) : null}

      <Panel>
        <FormGrid>
          <FormField
            label="Item Code"
            required
            size="lg"
            htmlFor="code"
            error={errors.code?.message}
          >
            {/* The item code is the main thing on this screen: mono 700 in
                --text, never the faint --text3. */}
            <Input
              id="code"
              mono
              className="fw-700"
              autoFocus
              autoComplete="off"
              placeholder="e.g. ITM-0001 (auto — editable)"
              {...register('code', {
                // Blank → undefined so the server auto-generates the next code;
                // a kept/typed value is validated by the schema's code rules.
                setValueAs: (v: string) =>
                  typeof v === 'string' && v.trim() ? v.trim() : undefined,
              })}
            />
          </FormField>

          <FormField
            label="Item Name"
            required
            size="lg"
            htmlFor="name"
            error={errors.name?.message}
          >
            <Input
              id="name"
              autoComplete="off"
              placeholder="Full part name"
              {...register('name')}
            />
          </FormField>

          <FormField
            label="Description"
            size="full"
            htmlFor="description"
            error={errors.description?.message}
          >
            <Input
              id="description"
              autoComplete="off"
              placeholder="Short description"
              {...register('description')}
            />
          </FormField>

          <FormField label="Material" size="lg" htmlFor="material" error={errors.material?.message}>
            <Input
              id="material"
              autoComplete="off"
              placeholder="EN8, SS304..."
              {...register('material')}
            />
          </FormField>

          <FormField label="UOM" size="xs" htmlFor="uom" error={errors.uom?.message}>
            <Select id="uom" options={UOMS} {...register('uom')} />
          </FormField>

          <FormField
            label="Item Type"
            size="md"
            htmlFor="itemType"
            error={errors.itemType?.message}
          >
            <Select id="itemType" options={ITEM_TYPES} {...register('itemType')} />
          </FormField>

          <FormField
            label="Source"
            size="lg"
            htmlFor="procurementType"
            error={errors.procurementType?.message}
          >
            <Select
              id="procurementType"
              title={SOURCE_HELP}
              options={PROCUREMENT_OPTIONS}
              {...register('procurementType')}
            />
          </FormField>

          <FormField label="HSN Code" size="lg" htmlFor="hsnCode" error={errors.hsnCode?.message}>
            <Input id="hsnCode" mono autoComplete="off" {...register('hsnCode')} />
          </FormField>

          <ItemImageField
            value={watch('imagePath')}
            onChange={(p) => setValue('imagePath', p, { shouldDirty: true })}
          />
        </FormGrid>
      </Panel>
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
      <ItemFormHeader
        title={props.title}
        backLabel={props.backLabel}
        onBack={props.onBack}
        onCancel={props.onCancel}
        isSubmitting={formState.isSubmitting}
      />

      {props.submitError ? (
        <Banner tone="error" role="alert">
          {props.submitError}
        </Banner>
      ) : null}

      <Panel>
        <FormGrid>
          {/* Read-only: the item code is permanent once the item exists. */}
          <FormField label="Item Code" required size="lg" htmlFor="code">
            <Input
              id="code"
              mono
              className="fw-700"
              value={props.item.code}
              placeholder="e.g. ITM-001"
              readOnly
            />
          </FormField>

          <FormField
            label="Item Name"
            required
            size="lg"
            htmlFor="name"
            error={errors.name?.message}
          >
            <Input
              id="name"
              autoComplete="off"
              placeholder="Full part name"
              {...register('name')}
            />
          </FormField>

          <FormField
            label="Description"
            size="full"
            htmlFor="description"
            error={errors.description?.message}
          >
            <Input
              id="description"
              autoComplete="off"
              placeholder="Short description"
              {...register('description')}
            />
          </FormField>

          <FormField label="Material" size="lg" htmlFor="material" error={errors.material?.message}>
            <Input
              id="material"
              autoComplete="off"
              placeholder="EN8, SS304..."
              {...register('material')}
            />
          </FormField>

          <FormField label="UOM" size="xs" htmlFor="uom" error={errors.uom?.message}>
            <Select id="uom" options={UOMS} {...register('uom')} />
          </FormField>

          <FormField
            label="Item Type"
            size="md"
            htmlFor="itemType"
            error={errors.itemType?.message}
          >
            <Select id="itemType" options={ITEM_TYPES} {...register('itemType')} />
          </FormField>

          <FormField
            label="Source"
            size="lg"
            htmlFor="procurementType"
            error={errors.procurementType?.message}
          >
            <Select
              id="procurementType"
              title={SOURCE_HELP}
              options={PROCUREMENT_OPTIONS}
              {...register('procurementType')}
            />
          </FormField>

          <FormField label="HSN Code" size="lg" htmlFor="hsnCode" error={errors.hsnCode?.message}>
            <Input id="hsnCode" mono autoComplete="off" {...register('hsnCode')} />
          </FormField>

          <ItemImageField
            value={watch('imagePath')}
            onChange={(p) => setValue('imagePath', p, { shouldDirty: true })}
          />
        </FormGrid>
      </Panel>
    </form>
  );
}
