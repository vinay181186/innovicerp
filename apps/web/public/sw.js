/* ADR-309 — task pop-ups. The ONLY job of this service worker is Web Push:
 * show a Windows pop-up for a task notice and open the right screen on click.
 *
 * There is deliberately NO fetch handler and NO cache. A caching worker would
 * keep serving old screens after a deploy; this one never touches a request.
 *
 * Payload (packages/shared taskPushPayloadSchema, built only by the API):
 *   { noticeId, kind, title, body, href, actorInitials }
 */
/* eslint-env serviceworker */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

/** Only same-origin paths are followed — never an outside link from a payload. */
function safeHref(href) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return '/';
  return href;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Innovic ERP';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.noticeId === 'string' ? data.noticeId : undefined,
    data: { href: safeHref(data.href) },
    renotify: false,
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      windowClients().then((list) => {
        for (const c of list) c.postMessage({ type: 'task-notice' });
      }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = safeHref(event.notification.data && event.notification.data.href);
  event.waitUntil(
    windowClients().then(async (list) => {
      const origin = self.location.origin;
      const client = list.find((c) => c.url && c.url.startsWith(origin));
      if (!client) return self.clients.openWindow(href);
      try {
        await client.focus();
      } catch (_e) {
        // focus can be refused; navigation below still lands the screen
      }
      if (typeof client.navigate === 'function') {
        try {
          await client.navigate(href);
          return undefined;
        } catch (_e) {
          // fall through to the message
        }
      }
      client.postMessage({ type: 'open', href });
      return undefined;
    }),
  );
});
