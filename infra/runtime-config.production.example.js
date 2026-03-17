window.__TESCORD_RUNTIME_CONFIG__ = {
  apiBaseUrl: 'https://chat.example.com',
  wsBaseUrl: 'wss://chat.example.com',
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: ['turn:chat.example.com:3478?transport=udp', 'turn:chat.example.com:3478?transport=tcp'],
      username: 'CHANGE_ME',
      credential: 'CHANGE_ME'
    },
    {
      urls: ['turns:chat.example.com:5349?transport=tcp'],
      username: 'CHANGE_ME',
      credential: 'CHANGE_ME'
    }
  ]
};
