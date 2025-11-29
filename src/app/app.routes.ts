import { Routes } from '@angular/router';
import { routes as tabRoutes } from './tabs/tabs.routes';

export const routes: Routes = [
  ...tabRoutes,
  {
    path: '**',
    redirectTo: '/tabs/home',
    pathMatch: 'full',
  },
];
