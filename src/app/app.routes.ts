import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tabs',
    loadChildren: () =>
      import('./pages/tabs/tabs.routes').then((m) => m.routes),
  },
  {
    path: '',
    redirectTo: 'tabs',
    pathMatch: 'full',
  },

  {
    path: 'profile-user',
    loadComponent: () =>
      import('./pages/profile-user/profile-user.page').then((m) => m.ProfileUserPage),
  },

  // If user manually types a bad URL → send to home
  {
    path: '**',
    redirectTo: '',
  },
];
