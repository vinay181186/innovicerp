// Task notices + desktop pop-ups (ADR-309, owner 2026-11-18).
//
// One task_notices row per person per task event feeds BOTH the bell and the
// Windows pop-up (Web Push), so the two can never disagree.
//
// Who gets one (decided by the owner 2026-11-18):
//   task_assigned  → the new assignee (create, reassign, QC Assign, Day Log
//                    reply task). Never the person who did it.
//   task_completed → who assigned it AND who created it (if different),
//                    manual or automatic close. Never the person who did it.
//   task_cancelled → the assignee. Never the person who did it.
//   Private to-dos (created_by = assigned_to) never make a notice.
//   Day Log reply on an already-open task (re-ping) makes NO notice.
import { z } from 'zod';

export const TASK_NOTICE_KINDS = ['task_assigned', 'task_completed', 'task_cancelled'] as const;
export const taskNoticeKindSchema = z.enum(TASK_NOTICE_KINDS);
export type TaskNoticeKind = z.infer<typeof taskNoticeKindSchema>;

/** push_status on a task_notices row. 'off' = the person has no laptop switched on. */
export const PUSH_STATUSES = ['pending', 'sent', 'failed', 'off'] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];

/** A failed push is retried this many times, then marked 'failed'. */
export const PUSH_MAX_ATTEMPTS = 3;
/** A push still pending after this long is dropped (no stale pop-ups). */
export const PUSH_MAX_AGE_HOURS = 24;
/** The API sender tick: picks up anything pending (a missed kick, a retry). */
export const PUSH_RETRY_INTERVAL_MS = 10_000;
/** A failed send is tried again no sooner than this after its last try. */
export const PUSH_RETRY_BACKOFF_MS = 15_000;

/** What the service worker receives and shows. Built only by the API. */
export const taskPushPayloadSchema = z.object({
  noticeId: z.string().uuid(),
  kind: taskNoticeKindSchema,
  /** Pop-up heading, e.g. "New task for you · TSK-00123". */
  title: z.string().max(120),
  /** Pop-up body lines. */
  body: z.string().max(300),
  /** Where a click lands, e.g. /task-board?view=inbox&task=<uuid>. */
  href: z.string().max(300),
  /** Initials for the actor (not shown by every OS). */
  actorInitials: z.string().max(4).nullable(),
});
export type TaskPushPayload = z.infer<typeof taskPushPayloadSchema>;

/** GET /me/push — is pop-up delivery set up on the server, and the public key. */
export const pushConfigResponseSchema = z.object({
  enabled: z.boolean(),
  /** VAPID public key (base64url). Null when the server has no keys. */
  publicKey: z.string().nullable(),
});
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;

/** POST /me/push/subscription — this browser's PushSubscription.toJSON(). */
export const savePushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});
export type SavePushSubscriptionInput = z.infer<typeof savePushSubscriptionInputSchema>;

/** DELETE /me/push/subscription (switch off on this laptop, or sign-out). */
export const removePushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(1000),
});
export type RemovePushSubscriptionInput = z.infer<typeof removePushSubscriptionInputSchema>;

/** POST /me/push/test — answer of the "Send test pop-up" link. */
export const pushTestResponseSchema = z.object({
  /** Laptops/browsers the test was sent to. 0 = none switched on. */
  sent: z.number().int().nonnegative(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;
