import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'workout-details',
    loadComponent: () =>
      import('./pages/workout-details/workout-details.page').then((m) => m.WorkoutDetailsPage),
  },

  // If user manually types a bad URL → send to home
  {
    path: '**',
    redirectTo: '',
  },
];
