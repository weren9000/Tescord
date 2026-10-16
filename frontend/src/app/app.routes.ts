import { Routes } from '@angular/router';

// AppComponent handles invitation preview/authentication; accept its URL on initial navigation.
export const routes: Routes = [
  {path: 'login', children: []},
  {path: 'invite/:code', children: []},
  {path: 'channels/:spaceId/:channelId', children: []},
];
