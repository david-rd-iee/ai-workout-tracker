import { Routes } from '@angular/router';
import { routes as tabRoutes } from './tabs/tabs.routes';

export const routes: Routes = [
  ...tabRoutes,
  {
    path: '**',
    redirectTo: '/tabs/home',
    pathMatch: 'full',
  },
  {
    path: 'groups',
    loadComponent: () => import('./pages/groups/groups.page').then(m => m.GroupsPage),
  },
  {
    path: 'groups',
    loadComponent: () => import('./pages/groups/groups.page').then( m => m.GroupsPage)
  },
];
