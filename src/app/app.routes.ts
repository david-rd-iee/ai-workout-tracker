import { Routes } from '@angular/router';
import { routes as tabRoutes } from './tabs/tabs.routes';

export const routes: Routes = [
  ...tabRoutes,
  {
    path: 'workout-summary',
    loadComponent: () => import('./pages/workout-summary/workout-summary.page').then(m => m.WorkoutSummaryPage)
  },
  {
    path: 'groups',
    loadComponent: () => import('./pages/groups/groups.page').then(m => m.GroupsPage)
  },
  {
    path: '**',
    redirectTo: '/tabs/home',
    pathMatch: 'full'
  }
];