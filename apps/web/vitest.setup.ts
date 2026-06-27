// Vitest setup for the web app — auto-clean the jsdom DOM between tests.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
