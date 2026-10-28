import { Routes } from '@angular/router';

// AppComponent handles invitation preview/authentication; accept its URL on initial navigation.
export const routes: Routes = [
  {path: 'my-room', children: []},
  {path: 'room/:code', children: []},
  {path: 'login', children: []},
  {path: 'invite/:code', children: []},
  {path: 'platform-invite/:code', children: []},
  {path: 'channels/:spaceId/:channelId', children: []},
];
