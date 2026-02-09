import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tabs',
    loadChildren: () =>
      import('./pages/tabs/tabs.routes').then((m) => m.routes),
  },
  {
    path: 'workout-details',
    loadComponent: () =>
      import('./pages/workout-details/workout-details.page').then((m) => m.WorkoutDetailsPage),
  },
  {
    path: '',
    redirectTo: 'tabs',
    pathMatch: 'full',
  },
  // If user manually types a bad URL → send to tabs
  {
    path: '**',
    redirectTo: 'tabs',
  },
];
