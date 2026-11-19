// ADR-309 — is the server's VAPID config usable? web-push's own validator
// (setVapidDetails checks the subject is mailto:/https: and both keys decode
// to the right length) run once, in a try. No env / database imports, so the
// unit test loads this file alone; sender.ts memoises the answer.

import webpush from 'web-push';
import type { VapidConfig } from './payload';

/** Null when the config is valid, else the reason it is not. */
export function vapidProblem(cfg: VapidConfig): string | null {
  try {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
