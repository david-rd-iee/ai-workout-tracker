import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadComponent: () => import('../home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'leaderboard',
        loadComponent: () => import('../pages/leaderboard/leaderboard.component').then((m) => m.LeaderboardComponent),
      },
      {
        path: 'account',
        loadComponent: () => import('../pages/account/client-account/client-account.page').then((m) => m.ClientAccountPage),
      },
      {
        path: '',
        redirectTo: '/tabs/home',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/tabs/home',
    pathMatch: 'full',
  },
];
