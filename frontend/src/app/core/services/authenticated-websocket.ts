/** The authentication frame precedes every application frame on this connection. */
export function authenticatedWebSocket(url: string, token: string): WebSocket {
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'authenticate', token }));
  }, { once: true });
  return socket;
}
