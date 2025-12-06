import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';
import { authGuard } from '../../services/account/auth.guard';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [

      // HOME
      {
        path: 'home',
        loadComponent: () =>
          import('../home/home.page').then((m) => m.HomePage),
        canActivate: [authGuard],
      },
      // GROUPS
      {
        path: 'groups',
        loadComponent: () =>
          import('../groups/groups.page').then((m) => m.GroupsPage),
        canActivate: [authGuard],
      },

      // LEADERBOARD
      {
        path: 'leaderboard',
        loadComponent: () =>
          import('../leaderboard/leaderboard.component').then(
            (m) => m.LeaderboardComponent
          ),
        canActivate: [authGuard],
      },

      // Default redirect under /tabs
      {
        path: '',
        redirectTo: '/tabs/home',
        pathMatch: 'full',
      },
    ],
  },

  // Root redirect
  {
    path: '',
    redirectTo: '/tabs/home',
    pathMatch: 'full',
  },
];
