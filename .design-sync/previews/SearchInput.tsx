import { SearchInput } from '@innovic/web';

export const ListToolbar = () => <SearchInput placeholder="Search SO no., customer, item…" />;

export const WithTerm = () => <SearchInput value="BRKT-101" />;

export const MediumWidth = () => <SearchInput width="md" placeholder="Search items…" />;

export const FullWidth = () => <SearchInput width="full" placeholder="Search anything… (Ctrl+K)" />;

export const Disabled = () => <SearchInput disabled placeholder="Pick a Customer first" />;
