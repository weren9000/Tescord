// Original Quiet Marsh glyphs: 24px grid, leaf cutouts, no raster textures.
import { PaintedGlyphName } from './painted-controls/painted-glyphs';
export type BotanicalGlyph = { body: string; line: string; accent: string };
export const BOTANICAL_GLYPHS: Record<PaintedGlyphName, BotanicalGlyph> = {
  heart: {
    body: 'M12 21C9 18 2 13 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 5-7 10-10 13zM13.3 12.7Q13.3 7.3 18.7 7.3Q18.7 12.7 13.3 12.7z',
    line: '',
    accent: '',
  },
  headphones: {
    body: 'M3 11a9 9 0 0 1 18 0v8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h1v-1a6 6 0 0 0-12 0v1h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    line: '',
    accent: '',
  },
  mic: {
    body: 'M8 7q0-5 4-5t4 5v5q0 5-4 5t-4-5z',
    line: 'M5 11v2q0 7 7 7t7-7v-2M12 20v2',
    accent: '',
  },
  micOff: {
    body: 'M9 3a4 4 0 0 1 7 3v5z',
    line: 'M3 3l18 18M8 9v3a4 4 0 0 0 6 3M5 11v1a7 7 0 0 0 12 5M19 11v1M12 19v3M9 22h6',
    accent: '',
  },
  camera: {
    body: 'M4 5h9q4 0 4 4v6q0 4-4 4H4q-3 0-3-4V9q0-4 3-4zM19 9l4-3v12l-4-3zM6 14q0-6 7-6q0 6-7 6z',
    line: '',
    accent: '',
  },
  cameraOff: {
    body: 'M4 5h10a3 3 0 0 1 3 3v1l4-3q2-1 2 1v10l-6-4z',
    line: 'M2 2l20 20M2 8v8a3 3 0 0 0 3 3h9',
    accent: '',
  },
  screen: {
    body: 'M9 19h6v2h3v2H6v-2h3z',
    line: 'M3 2h18v15H3zM8 10l4-4 4 4M12 6v8',
    accent: '',
  },
  groups: {
    body: 'M8.5 6a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM1 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM18 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM6 22v-5a6 6 0 0 1 12 0v5zM0 20v-4q0-4 5-4q-2 3-2 8zM21 20q0-5-2-8q5 0 5 4v4z',
    line: '',
    accent: '',
  },
  friends: {
    body: 'M3.5 7a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM15 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0zM1 21v-3a6 6 0 0 1 12 0v3zM15 21v-3q0-3-1-4q8-2 9 4v3z',
    line: '',
    accent: '',
  },
  hangup: {
    body: 'M2 10q10-9 20 0 2 2 1 4l-1 3q-1 1-2 0l-4-2v-4q-4-2-8 0v4l-4 2q-1 1-2 0l-1-3q-1-2 1-4z',
    line: '',
    accent: '',
  },
  chat: {
    body: 'M4 3h16q3 0 3 3v10q0 3-3 3H9l-6 4v-5q-2-1-2-3V6q0-3 3-3zM7 9v3h2V9zM11 9v3h2V9zM15 9v3h2V9z',
    line: '',
    accent: '',
  },
  files: {
    body: 'M4 1h10v7h7v13q0 2-2 2H4q-2 0-2-2V3q0-2 2-2zM16 1l5 5h-5zM7 18Q7 12 13 12Q13 18 7 18z',
    line: '',
    accent: '',
  },
  room: {
    body: 'M2 10 12 1l10 9v2h-2v11h-6v-7a2 2 0 0 0-4 0v7H4V12H2zM9.5 9.5Q9.5 4.5 14.5 4.5Q14.5 9.5 9.5 9.5z',
    line: '',
    accent: '',
  },
  platforms: {
    body: 'M9 4a3 3 0 1 0 6 0a3 3 0 1 0-6 0zM0.5 19a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM16.5 19a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z',
    line: 'M12 7v5M4 15v-3h16v3',
    accent: '',
  },
  bell: {
    body: 'M5 9a7 7 0 0 1 14 0v4q0 3 3 5H2q3-2 3-5z',
    line: '',
    accent: 'M9 20h6a3 3 0 0 1-6 0z',
  },
  settings: {
    body: 'M9 1h6l1 4 4-1 3 5-3 3 3 3-3 5-4-1-1 4H9l-1-4-4 1-3-5 3-3-3-3 3-5 4 1zM8 16Q8 8 16 8Q16 16 8 16z',
    line: '',
    accent: '',
  },
  sound: {
    body: 'M2 9h5l6-5v16l-6-5H2z',
    line: 'M17 8q5 4 0 8M16 11q1 1 0 2',
    accent: '',
  },
  soundOff: {
    body: '',
    line: 'M8 8l5-4v7M13 17v3l-6-5H2V9h2M3 3l18 18',
    accent: '',
  },
  invite: {
    body: 'M8 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M1 21v-3q0-6 7-6t7 6v3z',
    line: 'M19 7v8M15 11h8',
    accent: '',
  },
  close: {
    body: '',
    line: 'M6 6l12 12M18 6L6 18',
    accent: '',
  },
  check: {
    body: '',
    line: 'M4 12l5 5L20 5',
    accent: '',
  },
  download: {
    body: 'M2 20a10 3 0 1 0 20 0 10 3 0 1 0-20 0',
    line: 'M12 2v12M7 9l5 5 5-5',
    accent: '',
  },
  edit: {
    body: 'M3 16L15 4l5 5L8 21H3zM17 2q1-1 2 0l3 3q1 1 0 2l-1 1-5-5zM8.7 15.3Q8.7 10.7 13.3 10.7Q13.3 15.3 8.7 15.3z',
    line: '',
    accent: '',
  },
  reply: {
    body: 'M10 3L1 11l9 8v-5h4q5 0 8 6v-4q0-9-12-9z',
    line: '',
    accent: '',
  },
  calendar: {
    body: 'M3 5h18q2 0 2 2v3H1V7q0-2 2-2zM1 12h22v9q0 2-2 2H3q-2 0-2-2zM5 15h4v3H5zM15 15h4v3h-4zM5 20h4v2H5zM15 20h4v2h-4z',
    line: 'M6 2v4M18 2v4',
    accent: 'M10 5Q10 1 14 1Q14 5 10 5z',
  },
  filter: {
    body: '',
    line: 'M3 5h18M6 12h12M9 19h6',
    accent: '',
  },
  refresh: {
    body: 'M16 2l7 1-1 7zM8 22l-7-1 1-7zM9 15Q9 9 15 9Q15 15 9 15z',
    line: 'M20 7A9 9 0 0 0 4 7M4 17a9 9 0 0 0 16 0',
    accent: '',
  },
  link: {
    body: '',
    line: 'M9 15l6-6M8 9l3-3a5 5 0 0 1 7 7l-3 3M16 15l-3 3a5 5 0 0 1-7-7l3-3',
    accent: '',
  },
  send: {
    body: 'M2 5 23 1 17 22l-6-7-6 5v-8zM6 12l12-7-8 9-4 4z',
    line: '',
    accent: '',
  },
  attach: {
    body: '',
    line: 'M8 13l7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 14l8-8',
    accent: '',
  },
  eye: {
    body: 'M1 12Q12-5 23 12 12 29 1 12M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
    line: '',
    accent: '',
  },
  eyeOff: {
    body: '',
    line: 'M2 2l20 20M8 5q8-3 14 7l-3 4M15 19Q7 21 2 12l3-4M10 10a3 3 0 0 0 4 4',
    accent: '',
  },
  code: {
    body: '',
    line: 'M7 7l-5 5 5 5M17 7l5 5-5 5M14 3l-4 18',
    accent: '',
  },
  copy: {
    body: 'M8 1h12q2 0 2 2v14h-3V4H8zM3 6h12q2 0 2 2v13q0 2-2 2H3q-2 0-2-2V8q0-2 2-2zM6 17Q6 11 12 11Q12 17 6 17z',
    line: '',
    accent: '',
  },
  lock: {
    body: 'M5 10h14q2 0 2 2v8q0 2-2 2H5q-2 0-2-2v-8q0-2 2-2M11 14v4h2v-4z',
    line: 'M7 10V7a5 5 0 0 1 10 0v3',
    accent: '',
  },
  shop: {
    body: 'M4 2h16l3 7q0 5-5 3-3 3-6 0-3 3-6 0-5 2-5-3zM4 14l3 1 5-1 5 1 3-1v8h-5v-6H9v6H4z',
    line: '',
    accent: '',
  },
  callSettings: {
    body: 'M7 2h3v7H7zM15 9h3v7h-3zM6 16h3v7H6z',
    line: 'M3 5.5h18M3 12.5h18M3 19.5h18',
    accent: '',
  },
  gift: {
    body: 'M2 8h9v5H2zM13 8h9v5h-9zM4 15h7v7H4zM13 15h7v7h-7z',
    line: 'M12 8C1 9 4-2 9 3l3 5c11 1 8-10 3-5z',
    accent: '',
  },
  info: {
    body: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22M11 5v3h2V5zM10 10v2h1v6h3v-2h-1v-6z',
    line: '',
    accent: '',
  },
  profile: {
    body: 'M8 6a4 4 0 1 0 8 0a4 4 0 1 0-8 0zM3 23v-3q0-8 9-8t9 8v3zM9 21Q9 15 15 15Q15 21 9 21z',
    line: '',
    accent: '',
  },
  appearance: {
    body: 'M12 2C-1 2-2 20 10 22q5 0 3-4-1-3 3-3 7 0 6-5Q21 2 12 2zM5.5 8a1.5 1.5 0 1 0 3.0 0a1.5 1.5 0 1 0-3.0 0zM10.5 5.5a1.5 1.5 0 1 0 3.0 0a1.5 1.5 0 1 0-3.0 0zM15.5 8a1.5 1.5 0 1 0 3.0 0a1.5 1.5 0 1 0-3.0 0z',
    line: 'M16 22l7-9',
    accent: '',
  },
  logout: {
    body: 'M2 2h9v3H5v14h6v3H2zM15 5l8 7-8 7v-5H8v-4h7z',
    line: '',
    accent: '',
  },
  trash: {
    body: 'M4 8h16l-1 14H5zM8 11v8h2v-8zM14 11v8h2v-8zM2 4h20v2H2zM8 1h8v2H8z',
    line: '',
    accent: '',
  },
  block: {
    body: '',
    line: 'M5 5l14 14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
    accent: '',
  },
  pin: {
    body: 'M8 3q4-2 8 0v4l-2 2v4l4 4H6l4-4V9L8 7z',
    line: 'M12 17v5',
    accent: '',
  },
  inventory: {
    body: 'M3 9q0-7 9-7t9 7zM2 11h8v4h4v-4h8v8q0 3-4 3H6q-4 0-4-3z',
    line: 'M12 11v2',
    accent: '',
  },
  avatarAdmin: {
    body: 'M12 2l9 4v6q0 7-9 10q-9-3-9-10V6zM12 7a3 3 0 0 0-1.5 5.6L10 17h4l-.5-4.4A3 3 0 0 0 12 7z',
    line: '',
    accent: '',
  },
  hash: {
    body: '',
    line: 'M9 2L5 22M19 2l-4 20M3 8h19M2 16h19',
    accent: '',
  },
  minimize: {
    body: 'M3 17h18v3H3z',
    line: '',
    accent: '',
  },
  expand: {
    body: '',
    line: 'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7',
    accent: '',
  },
  search: {
    body: '',
    line: 'M17 17l5 5M19 10.5a8.5 8.5 0 1 1-17 0a8.5 8.5 0 1 1 17 0',
    accent: '',
  },
  plus: {
    body: 'M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z',
    line: '',
    accent: '',
  },
  menu: {
    body: 'M2 4h20v3H2zM2 11h20v3H2zM2 18h20v3H2z',
    line: '',
    accent: '',
  },
  back: {
    body: '',
    line: 'M15 3l-9 9 9 9',
    accent: '',
  },
  forward: {
    body: '',
    line: 'M9 3l9 9-9 9',
    accent: '',
  },
  down: {
    body: '',
    line: 'M3 8l9 9 9-9',
    accent: '',
  },
  up: {
    body: '',
    line: 'M3 16l9-9 9 9',
    accent: '',
  },
  phone: {
    body: 'M4 1h4l3 6-3 3q2 4 6 6l3-3 6 3v4q0 3-4 3Q2 22 1 5q0-4 3-4zM16 20Q16 16 20 16Q20 20 16 20z',
    line: '',
    accent: '',
  },
  more: {
    body: 'M1.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0-5.0 0zM17.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0-5.0 0z',
    line: '',
    accent: 'M9.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0-5.0 0z',
  },
  applications: {
    body: 'M3 2h5q2 0 2 2v4q0 2-2 2H3q-2 0-2-2V4q0-2 2-2zM16 2h5q2 0 2 2v4q0 2-2 2h-5q-2 0-2-2V4q0-2 2-2zM15.7 8.8Q15.7 3.2 21.3 3.2Q21.3 8.8 15.7 8.8zM3 14h5q2 0 2 2v5q0 2-2 2H3q-2 0-2-2v-5q0-2 2-2zM16 14h5q2 0 2 2v5q0 2-2 2h-5q-2 0-2-2v-5q0-2 2-2z',
    line: '',
    accent: '',
  },
  zoomIn: {
    body: '',
    line: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16 16l6 6M6 10h8M10 6v8',
    accent: '',
  },
  zoomOut: {
    body: '',
    line: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16 16l6 6M6 10h8',
    accent: '',
  },
  wrap: {
    body: '',
    line: 'M2 5h20M2 11h15a4 4 0 0 1 0 8h-5M15 16l-3 3 3 3M2 18h5',
    accent: '',
  },
  upload: {
    body: '',
    line: 'M12 16V2M7 7l5-5 5 5M3 16v6h18v-6',
    accent: '',
  },
  star: {
    body: 'M12 1l3.3 6.8 7.5 1.1-5.4 5.3 1.3 7.5-6.7-3.5-6.7 3.5 1.3-7.5-5.4-5.3 7.5-1.1z',
    line: '',
    accent: '',
  },
  location: {
    body: 'M12 1a9 9 0 0 0-9 9q0 6 9 13 9-7 9-13a9 9 0 0 0-9-9M12 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8',
    line: '',
    accent: '',
  },
  vacation: {
    body: 'M16 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M2 13q6-6 12 0z',
    line: 'M8 13v8M3 22h13M16 13v3M21 11l2 2',
    accent: '',
  },
  emoji: {
    body: 'M3 9C-3 0 10-3 10 6h4C14-3 27 0 21 9a10 9 0 1 1-18 0zM3.4 4a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0zM17.4 4a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0zM6 12q2-3 4 0l-1 1q-1-2-2 0zM14 12q2-3 4 0l-1 1q-1-2-2 0zM7 16q5 4 10 0l1 1q-6 6-12 0z',
    line: '',
    accent: '',
  },
  warning: {
    body: 'M12 1L24 22H0zM11 8v7h2V8zM11 17v3h2v-3z',
    line: '',
    accent: '',
  },
  play: {
    body: 'M5 2l17 10L5 22z',
    line: '',
    accent: '',
  },
  pause: {
    body: 'M4 2h6v20H4zM14 2h6v20h-6z',
    line: '',
    accent: '',
  },
  undo: {
    body: 'M9 1L1 8l8 7V9h5a6 6 0 0 1 0 12h-3v2h3a8 8 0 0 0 0-16H9z',
    line: '',
    accent: '',
  },
  save: {
    body: 'M2 2h17l3 3v17H2zM6 3v6h11V3zM6 14v7h12v-7z',
    line: '',
    accent: '',
  },
  screenOff: {
    body: 'M9 19h6v2h3v2H6v-2h3z',
    line: 'M3 2h18v15H3z',
    accent: 'M9 6h6v7H9z',
  },
  bellOff: {
    body: '',
    line: 'M3 3l18 18M9 4a6 6 0 0 1 9 5v5M6 8q0 6-3 9h14M10 21h4',
    accent: '',
  },
  coin: {
    body: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16',
    line: 'M10 7v10M15 7l-5 5 5 5',
    accent: '',
  },
  crystal: {
    body: 'M6 2h12l6 7-12 14L0 9zM7 4l-3 4h5zM10 4l2 4 2-4zM17 4l-2 4h5zM4 10l6 8-1-8zM12 10v8l3-8z',
    line: '',
    accent: '',
  },
};
