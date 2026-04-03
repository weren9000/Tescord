self.addEventListener('push', (event) => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'Altgramm';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/assets/Icons.png',
    badge: payload.badge || '/assets/Icons.png',
    tag: payload.tag || 'altgramm-message',
    data: {
      conversationId: payload.conversationId || null,
      url: payload.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.url || '/';
  const conversationId = data.conversationId || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== self.location.origin) {
          continue;
        }

        client.postMessage({
          type: 'open_conversation',
          conversationId,
        });
        return client.focus();
      }

      return clients.openWindow(targetUrl);
    })
  );
});
