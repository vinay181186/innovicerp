// ADR-234: the web shows the ✓/✗ on an edit (and ADR-235 cancel) request only
// to holders of Approve on DOCUMENT_EDIT_FORM_KEY[entity]; the server decides
// with the registry entry's own formKey. They must be the same key.
import { DOCUMENT_EDIT_FORM_KEY } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { DOC_EDIT_REGISTRY } from './registry';

describe('document edit form keys', () => {
  it('shared DOCUMENT_EDIT_FORM_KEY matches every server registry entry', () => {
    for (const [entity, entry] of Object.entries(DOC_EDIT_REGISTRY)) {
      expect([entity, entry?.formKey]).toEqual([
        entity,
        DOCUMENT_EDIT_FORM_KEY[entity as keyof typeof DOCUMENT_EDIT_FORM_KEY],
      ]);
    }
  });
});
