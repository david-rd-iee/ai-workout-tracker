import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.page').then((m) => m.HomePage),
  },

  // If user manually types a bad URL → send to home
  {
    path: '**',
    redirectTo: '',
  },
];
