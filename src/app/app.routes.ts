import { Routes } from '@angular/router';
import { routes as tabRoutes } from './tabs/tabs.routes';

export const routes: Routes = [
  ...tabRoutes,
  {
    path: 'workout-summary',
    loadComponent: () => import('./pages/workout-summary/workout-summary.page').then( m => m.WorkoutSummaryPage)
  },
  {
    path: '**',
    redirectTo: '/tabs/home',
    pathMatch: 'full',
  },
  {
    path: 'workout-summary',
    loadComponent: () => import('./pages/workout-summary/workout-summary.page').then( m => m.WorkoutSummaryPage)
  },

];
