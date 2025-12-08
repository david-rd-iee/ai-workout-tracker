import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/tabs/home',
    pathMatch: 'full',
  },
  {
    path: 'tabs',
    loadChildren: () =>
      import('./pages/tabs/tabs.routes').then((m) => m.routes),
  },
  {
    path: 'workout-summary',
    loadComponent: () =>
      import('./pages/workout-summary/workout-summary.page').then((m) => m.WorkoutSummaryPage),
  },

  // If user manually types a bad URL → send to home
  {
    path: '**',
    redirectTo: '/tabs/home',
  },
];
