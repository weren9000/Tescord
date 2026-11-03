// Compact companion glyphs: cream silhouettes on the painted control surfaces.
export const PAINTED_GLYPHS = {
  headphones: {
    body: 'M3 11a9 9 0 0 1 18 0v8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h1v-1a6 6 0 0 0-12 0v1h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    line: '',
  },
  mic: {
    body: 'M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z',
    line: 'M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6',
  },
  micOff: {
    body: 'M9 3a4 4 0 0 1 7 3v5z',
    line: 'M3 3l18 18M8 9v3a4 4 0 0 0 6 3M5 11v1a7 7 0 0 0 12 5M19 11v1M12 19v3M9 22h6',
  },
  camera: {
    body: 'M4 5h10a3 3 0 0 1 3 3v1l4-3q2-1 2 1v10q0 2-2 1l-4-3v1a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z',
    line: '',
  },
  cameraOff: {
    body: 'M4 5h10a3 3 0 0 1 3 3v1l4-3q2-1 2 1v10l-6-4z',
    line: 'M2 2l20 20M2 8v8a3 3 0 0 0 3 3h9',
  },
  screen: {
    body: 'M9 19h6v2h3v2H6v-2h3z',
    line: 'M4 3h16q2 0 2 2v11q0 2-2 2H4q-2 0-2-2V5q0-2 2-2zM7 13q1-5 8-5M12 5l4 3-4 3',
  },
  groups: {
    body: 'M8 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M18 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6M1 19q0-7 7-7t7 7v2H1zM17 12q6 0 6 7v2h-6q2-5-1-9z',
    line: '',
  },
  friends: {
    body: 'M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M17 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M0 20q0-7 7-7 5 0 5 7v1H0zM14 20q0-4-2-6 8-4 12 6v1H14z',
    line: '',
  },
  hangup: {
    body: 'M2 10q10-9 20 0 2 2 1 4l-1 3q-1 1-2 0l-4-2v-4q-4-2-8 0v4l-4 2q-1 1-2 0l-1-3q-1-2 1-4z',
    line: '',
  },
  chat: {
    body: 'M4 3h16q3 0 3 3v10q0 3-3 3H9l-6 4v-5q-2-1-2-3V6q0-3 3-3zM7 9v3h2V9zM11 9v3h2V9zM15 9v3h2V9z',
    line: '',
  },
  files: {
    body: 'M5 1h9l6 6v14q0 2-2 2H5q-2 0-2-2V3q0-2 2-2zM13 3v5h5zM7 12v2h9v-2zM7 17v2h7v-2z',
    line: '',
  },
  room: { body: 'M3 3q0-2 2-2h14q2 0 2 2v20h-5V5H7v18H3z', line: 'M7 5l7 3v14l-7 1M10 13v2' },
  platforms: {
    body: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18',
    line: 'M4 7C-7 18 1 23 14 16S29 1 20 5',
  },
  bell: { body: 'M5 9a7 7 0 0 1 14 0q0 6 3 8v2H2v-2q3-2 3-8M9 21h6a3 3 0 0 1-6 0', line: '' },
  settings: {
    body: 'M9 1h6l1 4 4-1 3 5-3 3 3 3-3 5-4-1-1 4H9l-1-4-4 1-3-5 3-3-3-3 3-5 4 1zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    line: '',
  },
  sound: { body: 'M2 9h5l6-5v16l-6-5H2z', line: 'M17 8q5 4 0 8M16 11q1 1 0 2' },
  soundOff: { body: 'M2 9h5l6-5v16l-6-5H2z', line: 'M17 9l5 6M22 9l-5 6' },
  invite: {
    body: 'M8 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M1 21v-3q0-6 7-6t7 6v3z',
    line: 'M19 7v8M15 11h8',
  },
  close: { body: '', line: 'M6 6l12 12M18 6L6 18' },
  check: { body: '', line: 'M4 12l5 5L20 5' },
  download: { body: '', line: 'M12 2v13M7 10l5 5 5-5M3 16v5h18v-5' },
  edit: { body: 'M3 16L15 4l5 5L8 21H3zM17 2q1-1 2 0l3 3q1 1 0 2l-1 1-5-5z', line: '' },
  reply: { body: 'M10 3L1 11l9 8v-5h4q5 0 8 6v-4q0-9-12-9z', line: '' },
  calendar: {
    body: 'M4 4h16q2 0 2 2v3H2V6q0-2 2-2M2 11h20v9q0 2-2 2H4q-2 0-2-2zM6 14v3h3v-3zM11 14v3h3v-3z',
    line: 'M7 2v4M17 2v4',
  },
  filter: { body: 'M2 3h20L15 12v7l-6 3V12z', line: '' },
  refresh: {
    body: 'M16 2l7 1-1 7zM8 22l-7-1 1-7z',
    line: 'M20 7A9 9 0 0 0 4 7M4 17a9 9 0 0 0 16 0',
  },
  link: { body: '', line: 'M9 15l6-6M8 9l3-3a5 5 0 0 1 7 7l-3 3M16 15l-3 3a5 5 0 0 1-7-7l3-3' },
  send: { body: 'M2 2l21 10L2 22l3-8 11-2-11-2z', line: '' },
  attach: { body: '', line: 'M8 13l7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 14l8-8' },
  eye: {
    body: 'M1 12Q12-5 23 12 12 29 1 12M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
    line: '',
  },
  eyeOff: {
    body: '',
    line: 'M2 2l20 20M8 5q8-3 14 7l-3 4M15 19Q7 21 2 12l3-4M10 10a3 3 0 0 0 4 4',
  },
  code: { body: '', line: 'M7 7l-5 5 5 5M17 7l5 5-5 5M14 3l-4 18' },
  copy: {
    body: 'M4 1h11v3H6v13H2V3q0-2 2-2M10 6h10q2 0 2 2v12q0 2-2 2H10q-2 0-2-2V8q0-2 2-2z',
    line: '',
  },
  lock: {
    body: 'M5 10h14q2 0 2 2v8q0 2-2 2H5q-2 0-2-2v-8q0-2 2-2M11 14v4h2v-4z',
    line: 'M7 10V7a5 5 0 0 1 10 0v3',
  },
  shop: {
    body: 'M4 2h16l3 7q0 5-5 3-3 3-6 0-3 3-6 0-5 2-5-3zM4 14l3 1 5-1 5 1 3-1v8h-5v-6H9v6H4z',
    line: '',
  },
  callSettings: {
    body: 'M7 2h3v7H7zM15 9h3v7h-3zM6 16h3v7H6z',
    line: 'M3 5.5h18M3 12.5h18M3 19.5h18',
  },
  gift: {
    body: 'M2 8h9v5H2zM13 8h9v5h-9zM4 15h7v7H4zM13 15h7v7h-7z',
    line: 'M12 8C1 9 4-2 9 3l3 5c11 1 8-10 3-5z',
  },
  info: {
    body: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22M11 5v3h2V5zM10 10v2h1v6h3v-2h-1v-6z',
    line: '',
  },
  profile: { body: 'M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10M2 22v-2q0-6 10-6t10 6v2z', line: '' },
  appearance: {
    body: 'M3 2h18q2 0 2 2v16q0 2-2 2H3q-2 0-2-2V4q0-2 2-2M4 5v14h16V5zM5 18l5-7 4 4 3-4 2 7zM16 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
    line: '',
  },
  logout: { body: 'M2 2h9v3H5v14h6v3H2zM15 5l8 7-8 7v-5H8v-4h7z', line: '' },
  trash: { body: 'M4 8h16l-1 14H5zM8 11v8h2v-8zM14 11v8h2v-8zM2 4h20v2H2zM8 1h8v2H8z', line: '' },
  block: { body: '', line: 'M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20' },
  pin: { body: 'M7 2h10l-2 7 5 5v3H4v-3l5-5z', line: 'M12 17v5' },
  inventory: { body: 'M2 4h20v6H2zM3 12h18v10H3zM9 14v3h6v-3z', line: '' },
  avatarAdmin: { body: 'M12 1l10 4v7q0 7-10 11Q2 19 2 12V5zM7 12l4 4 7-8-2-1-5 6-2-3z', line: '' },
  hash: { body: '', line: 'M9 2L5 22M19 2l-4 20M3 8h19M2 16h19' },
  minimize: { body: 'M3 17h18v3H3z', line: '' },
  expand: { body: '', line: 'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7' },
  search: { body: '', line: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16 16l6 6' },
  plus: { body: 'M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z', line: '' },
  menu: { body: 'M2 4h20v3H2zM2 11h20v3H2zM2 18h20v3H2z', line: '' },
  back: { body: '', line: 'M15 3l-9 9 9 9' },
  forward: { body: '', line: 'M9 3l9 9-9 9' },
  down: { body: '', line: 'M3 8l9 9 9-9' },
  up: { body: '', line: 'M3 16l9-9 9 9' },
  phone: { body: 'M4 1h4l3 6-3 3q2 4 6 6l3-3 6 3v4q0 3-4 3Q2 22 1 5q0-4 3-4z', line: '' },
  more: {
    body: 'M4 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M20 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    line: '',
  },
  applications: { body: 'M2 2h8v8H2zM14 2h8v8h-8zM2 14h8v8H2zM14 14h8v8h-8z', line: '' },
  zoomIn: { body: '', line: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16 16l6 6M6 10h8M10 6v8' },
  zoomOut: { body: '', line: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16 16l6 6M6 10h8' },
  wrap: { body: '', line: 'M2 5h20M2 11h15a4 4 0 0 1 0 8h-5M15 16l-3 3 3 3M2 18h5' },
  upload: { body: '', line: 'M12 16V2M7 7l5-5 5 5M3 16v6h18v-6' },
  star: {
    body: 'M12 1l3.3 6.8 7.5 1.1-5.4 5.3 1.3 7.5-6.7-3.5-6.7 3.5 1.3-7.5-5.4-5.3 7.5-1.1z',
    line: '',
  },
  location: {
    body: 'M12 1a9 9 0 0 0-9 9q0 6 9 13 9-7 9-13a9 9 0 0 0-9-9M12 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8',
    line: '',
  },
  vacation: {
    body: 'M16 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M2 13q6-6 12 0z',
    line: 'M8 13v8M3 22h13M16 13v3M21 11l2 2',
  },
  emoji: { body: '', line: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M7 14q5 6 10 0M8 8v1M16 8v1' },
  warning: { body: 'M12 1L24 22H0zM11 8v7h2V8zM11 17v3h2v-3z', line: '' },
  play: { body: 'M5 2l17 10L5 22z', line: '' },
  pause: { body: 'M4 2h6v20H4zM14 2h6v20h-6z', line: '' },
  undo: { body: 'M9 1L1 8l8 7V9h5a6 6 0 0 1 0 12h-3v2h3a8 8 0 0 0 0-16H9z', line: '' },
  save: { body: 'M2 2h17l3 3v17H2zM6 3v6h11V3zM6 14v7h12v-7z', line: '' },
  screenOff: {
    body: 'M9 19h6v2h3v2H6v-2h3z',
    line: 'M3 3l18 18M8 3h12q2 0 2 2v10M3 7v9q0 2 2 2h10',
  },
  bellOff: { body: '', line: 'M3 3l18 18M9 4a6 6 0 0 1 9 5v5M6 8q0 6-3 9h14M10 21h4' },
  coin: {
    body: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16',
    line: 'M10 7v10M15 7l-5 5 5 5',
  },
  crystal: {
    body: 'M6 2h12l6 7-12 14L0 9zM7 4l-3 4h5zM10 4l2 4 2-4zM17 4l-2 4h5zM4 10l6 8-1-8zM12 10v8l3-8z',
    line: '',
  },
} as const;
export type PaintedGlyphName = keyof typeof PAINTED_GLYPHS;
export const PAINTED_ART_NAMES = [
  'room',
  'friends',
  'groups',
  'platforms',
  'chat',
  'files',
  'mic',
  'headphones',
  'camera',
  'screen',
  'bell',
  'settings',
  'applications',
  'inventory',
  'shop',
  'gift',
  'appearance',
  'profile',
  'security',
  'calendar',
] as const;
export type PaintedArtName = (typeof PAINTED_ART_NAMES)[number];
