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
        path: 'groups',
        loadComponent: () => import('../pages/groups/groups.page').then(m => m.GroupsPage)
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
