import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
const meetingPage = /^\/(?:my-room\/?|room\/[A-Za-z0-9_-]+\/?)$/.test(location.pathname);
const component = meetingPage
  ? import('./app/rooms/room-page.component').then(m => m.RoomPageComponent)
  : import('./app/app.component').then(m => m.AppComponent);
component.then(c => bootstrapApplication(c, appConfig)).catch(err => console.error(err));
