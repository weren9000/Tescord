import { Component, input } from '@angular/core';

const paths: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
  chat: 'M4 4h16v12H9l-5 4V4M8 8h8M8 12h5',
  headphones: 'M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v8H4zM17 12h3v8h-3z',
  shop: 'M3 9l2-6h14l2 6M3 9v3a3 3 0 0 0 4 2 3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 4-2V9H3M5 15v6h14v-6M10 21v-5h4v5',
  callSettings: 'M9 3h6l.5 2.5 2 1.2 2.4-.8 2 3.4-1.9 1.7v2l1.9 1.7-2 3.4-2.4-.8-2 1.2L15 21H9l-.5-2.5-2-1.2-2.4.8-2-3.4L4 13v-2L2.1 9.3l2-3.4 2.4.8 2-1.2zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  gift: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C3 8 5 1 9 3l3 5M12 8c9 0 7-7 3-5z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7h.01',
  profile: 'M20 21v-2a7 7 0 0 0-14 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  appearance: 'M3 4h18v16H3zM3 16l5-5 5 5 4-4 4 4M15 8h.01',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  logout: 'M9 3H3v18h6M9 12h12M17 8l4 4-4 4',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  block: 'M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  pin: 'M9 3h6l-1 6 4 4v2H6v-2l4-4zM12 15v6',
  inventory: 'M3 7h18v14H3zM2 3h20v4H2zM9 11h6',
  avatarAdmin: 'M12 3l9 4v5c0 5-9 10-9 10S3 17 3 12V7zM8 12l3 3 5-6',
  hash: 'M5 9h15M4 15h15M11 3L7 21M17 3l-4 18',
  check: 'M5 12l4 4L19 6',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  micOff: 'M3 3l18 18M9 5a3 3 0 0 1 6 0v6M9 9v3a3 3 0 0 0 5 2M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8',
  sound: 'M4 10v5h4l5 4V6l-5 4zM17 8a7 7 0 0 1 0 9M16 11a3 3 0 0 1 0 3',
  soundOff: 'M4 10v5h4l5 4V6l-5 4zM17 10l5 5M22 10l-5 5',
  camera: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l5-3v10l-5-3',
  screen: 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 17v4M8 21h8M12 13V7M9 10l3-3 3 3',
  hangup: 'M3 12c5-5 13-5 18 0v5h-5v-4a12 12 0 0 0-8 0v4H3z',
  minimize: 'M5 16h14',
  expand: 'M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8',
  friends: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8h5M19.5 5.5v5',
  groups: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  platforms: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M16 16l5 5',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.09 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z',
  files: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

@Component({
  selector: 'app-ui-icon', standalone: true,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="paths[name()] || paths['more']" /></svg>`,
  styles: [':host{display:inline-flex;width:20px;height:20px;flex-shrink:0}svg{width:100%;height:100%}'],
})
export class UiIconComponent {
  readonly name = input('more');
  readonly paths = paths;
}
