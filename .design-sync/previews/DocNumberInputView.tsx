import { DocNumberInputView, FormGrid } from '@innovic/web';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <FormGrid style={{ width: 300 }}>{children}</FormGrid>
);

export const AutoFilled = () => (
  <Wrap>
    <DocNumberInputView size="full" label="SO No." required value="IN-SO-00143" />
  </Wrap>
);

export const Checking = () => (
  <Wrap>
    <DocNumberInputView size="full" label="SO No." required value="IN-SO-00143" state="checking" />
  </Wrap>
);

export const Available = () => (
  <Wrap>
    <DocNumberInputView size="full" label="SO No." required value="IN-SO-00143" state="ok" />
  </Wrap>
);

export const Duplicate = () => (
  <Wrap>
    <DocNumberInputView
      size="full"
      label="SO No."
      required
      value="IN-SO-00123"
      state="bad"
      message="Duplicate — this number already exists"
    />
  </Wrap>
);

export const ReadOnly = () => (
  <Wrap>
    <DocNumberInputView size="full" label="PO No." value="IN-MPO-00311" readOnly />
  </Wrap>
);
