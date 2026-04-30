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
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateItemInput>;
  onSubmit: (values: CreateItemInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  item: Item;
  onSubmit: (values: UpdateItemInput) => Promise<void> | void;
  submitLabel?: string;
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

export function ItemForm(props: ItemFormProps) {
  if (props.mode === 'create') return <CreateItemForm {...props} />;
  return <EditItemForm {...props} />;
}

function CreateItemForm(props: CreateMode) {
  const form = useForm<CreateItemInput>({
    resolver: zodResolver(createItemInputSchema),
    defaultValues: { ...CREATE_DEFAULTS, ...props.defaultValues },
  });
  const { register, formState } = form;
  const errors = formState.errors;

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <FieldRow>
        <Field label="Code" htmlFor="code" error={errors.code?.message} required>
          <Input id="code" autoFocus autoComplete="off" {...register('code')} />
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Item type" htmlFor="itemType" error={errors.itemType?.message}>
          <Select id="itemType" {...register('itemType')}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="UOM" htmlFor="uom" error={errors.uom?.message}>
          <Select id="uom" {...register('uom')}>
            {UOMS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Revision" htmlFor="revision" error={errors.revision?.message}>
          <Input id="revision" autoComplete="off" {...register('revision')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Drawing no" htmlFor="drawingNo" error={errors.drawingNo?.message}>
          <Input id="drawingNo" autoComplete="off" {...register('drawingNo')} />
        </Field>
        <Field label="Material" htmlFor="material" error={errors.material?.message}>
          <Input id="material" autoComplete="off" {...register('material')} />
        </Field>
        <Field label="HSN code" htmlFor="hsnCode" error={errors.hsnCode?.message}>
          <Input id="hsnCode" autoComplete="off" {...register('hsnCode')} />
        </Field>
      </FieldRow>

      <Field label="Description" htmlFor="description" error={errors.description?.message}>
        <Textarea id="description" rows={3} {...register('description')} />
      </Field>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Create item'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditItemForm(props: EditMode) {
  const form = useForm<UpdateItemInput>({
    resolver: zodResolver(updateItemInputSchema),
    defaultValues: itemToUpdateDefaults(props.item),
  });
  const { register, formState } = form;
  const errors = formState.errors;

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <FieldRow>
        <Field label="Code" htmlFor="code">
          <Input id="code" value={props.item.code} disabled readOnly />
          <p className="mt-1 text-xs text-muted-foreground">Code cannot be changed after creation.</p>
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Item type" htmlFor="itemType" error={errors.itemType?.message}>
          <Select id="itemType" {...register('itemType')}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="UOM" htmlFor="uom" error={errors.uom?.message}>
          <Select id="uom" {...register('uom')}>
            {UOMS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Revision" htmlFor="revision" error={errors.revision?.message}>
          <Input id="revision" autoComplete="off" {...register('revision')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Drawing no" htmlFor="drawingNo" error={errors.drawingNo?.message}>
          <Input id="drawingNo" autoComplete="off" {...register('drawingNo')} />
        </Field>
        <Field label="Material" htmlFor="material" error={errors.material?.message}>
          <Input id="material" autoComplete="off" {...register('material')} />
        </Field>
        <Field label="HSN code" htmlFor="hsnCode" error={errors.hsnCode?.message}>
          <Input id="hsnCode" autoComplete="off" {...register('hsnCode')} />
        </Field>
      </FieldRow>

      <Field label="Description" htmlFor="description" error={errors.description?.message}>
        <Textarea id="description" rows={3} {...register('description')} />
      </Field>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Save changes'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function FieldRow(props: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{props.children}</div>;
}

function Field(props: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.htmlFor}>
        {props.label}
        {props.required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {props.children}
      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
    </div>
  );
}

function FormFooter(props: {
  isSubmitting: boolean;
  submitLabel: string;
  submitError: string | null;
  onCancel?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-3">
      {props.submitError ? (
        <p className="text-sm text-destructive">{props.submitError}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={props.isSubmitting}>
          {props.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {props.submitLabel}
        </Button>
        {props.onCancel ? (
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
