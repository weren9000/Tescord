// Outline companion set for the Constellation interface. Geometry uses a 24px grid.
import { PaintedGlyphName, PAINTED_GLYPHS } from './painted-controls/painted-glyphs';

const outlines: Partial<Record<PaintedGlyphName, string>> = {
  micOff:
    'M3 3l18 18M8 8v4a4 4 0 0 0 6 3M9 3a4 4 0 0 1 7 3v5M5 11v1a7 7 0 0 0 12 5M19 11v1M12 19v3M9 22h6',
  cameraOff: 'M2 2l20 20M8 5h7v4l6-3v12l-6-3M3 8v11h12',
  screen: 'M3 3h18v14H3zM12 17v4M7 21h10M8 11l4-4 4 4M12 7v6',
  screenOff: 'M2 2l20 20M8 3h13v12M3 7v10h14M12 17v4M7 21h10',
  invite: 'M8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 21v-3a6 6 0 0 1 12 0v3M19 7v8M15 11h8',
  settings:
    'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  vacation: 'M17 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M2 13q6-7 12 0zM8 13v8M3 22h13',

  room: 'M3 10l9-7 9 7v11h-6v-7H9v7H3z',
  friends:
    'M7 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M17 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M2 21v-3a5 5 0 0 1 10 0v3zM15 13a5 5 0 0 1 7 5v3h-7',
  groups:
    'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 21v-3a6 6 0 0 1 12 0v3M5 6a2.5 2.5 0 1 0 0 5M19 6a2.5 2.5 0 1 1 0 5M2 19v-2q0-3 3-3M22 19v-2q0-3-3-3',
  platforms: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14M7 6C-5 15 0 24 14 16S27 0 17 5',
  inventory: 'M3 4h18v5H3zM5 9v12h14V9M10 13h4',
  applications: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  avatarAdmin: 'M12 2l9 4v6q0 7-9 10-9-3-9-10V6zM8 12l3 3 5-6',
  bell: 'M5 10a7 7 0 0 1 14 0v5l2 3H3l2-3zM9 21h6',
  profile: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-2a8 6 0 0 1 16 0v2z',
  menu: 'M3 5h18M3 12h18M3 19h18',
  plus: 'M12 4v16M4 12h16',
  more: 'M5 11v2M12 11v2M19 11v2',
  chat: 'M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2z',
  headphones:
    'M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v9H4q-2 0-2-2v-5q0-2 2-2M20 12h-3v9h3q2 0 2-2v-5q0-2-2-2',
  mic: 'M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6',
  camera: 'M3 5h12v14H3zM15 9l6-3v12l-6-3',
  files: 'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6',
  sound: 'M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8M19 5q8 7 0 14',
  soundOff: 'M3 9h4l5-4v14l-5-4H3zM16 9l5 6M21 9l-5 6',
  phone: 'M5 3h3l3 5-3 3q2 3 5 5l3-3 5 3v3q0 3-4 2Q3 20 2 7q0-4 3-4z',
  hangup: 'M3 10q9-7 18 0l1 5-5 1-1-5q-4-2-8 0l-1 5-5-1z',
  send: 'M3 3l18 9-18 9 3-9zM6 12h15',
  heart: 'M12 21C9 18 2 13 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 5-7 10-10 13z',
  edit: 'M4 16L16 4l4 4L8 20H4zM14 6l4 4',
  reply: 'M10 5l-7 7 7 7v-5h4q5 0 7 5v-3q0-7-11-7z',
  calendar: 'M4 5h16v16H4zM8 2v6M16 2v6M4 10h16M8 14h2M14 14h2',
  filter: 'M3 4h18l-7 8v7l-4 2v-9z',
  refresh: 'M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M16 16h5v5',
  eye: 'M2 12Q12-2 22 12 12 26 2 12zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  copy: 'M8 7h12v15H8zM4 17H2V2h12v2',
  lock: 'M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v4',
  shop: 'M4 3h16l2 6q0 4-5 3-2 2-5 0-3 2-5 0-5 1-5-3zM4 14v7h16v-7M9 21v-6h6v6',
  callSettings: 'M3 6h6M13 6h8M3 12h12M19 12h2M3 18h3M10 18h11M9 3v6h4V3zM15 9v6h4V9zM6 15v6h4v-6z',
  gift: 'M3 8h18v5H3zM5 13v9h14v-9M12 8v14M12 8C1 8 4-1 9 4l3 4c11 0 8-9 3-4z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 7v1M12 11v6',
  appearance: 'M3 3h18v18H3zM4 18l6-7 4 4 3-4 4 7M16 6v1',
  logout: 'M9 3H3v18h6M9 12h12M16 7l5 5-5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  pin: 'M8 3h8l-1 6 4 5v2H5v-2l4-5zM12 16v6',
  minimize: 'M4 18h16',
  star: 'M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  location: 'M12 22q8-8 8-13A8 8 0 0 0 4 9q0 5 8 13zM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  warning: 'M12 2L2 21h20zM12 9v5M12 17v1',
  play: 'M6 3l15 9-15 9z',
  pause: 'M5 3h4v18H5zM15 3h4v18h-4z',
  undo: 'M9 3L3 9l6 6M3 9h11a6 6 0 0 1 0 12h-3',
  save: 'M3 3h15l3 3v15H3zM7 3v6h10V3M7 21v-7h10v7',
  coin: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M9 7v10M15 7l-6 5 6 5',
  crystal: 'M6 3h12l4 6-10 13L2 9zM2 9h20M8 3l4 19 4-19',
};

export function constellationGlyph(name: PaintedGlyphName): string {
  const glyph = PAINTED_GLYPHS[name];
  return outlines[name] ?? [glyph.body, glyph.line].filter(Boolean).join(' ');
}
