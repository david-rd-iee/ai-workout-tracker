import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';
import { authGuard, userTypeGuard } from '../../services/account/auth.guard';

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

      // LEADERBOARD (from feature/leader-board)
      {
        path: 'leaderboard',
        loadComponent: () =>
          import('../leaderboard/leaderboard.component').then(
            (m) => m.LeaderboardComponent
          ),
        canActivate: [authGuard],
      },

      // PROFILE
      {
        path: 'profile',
        loadComponent: () =>
          import('../../pages/login/login.page').then((m) => m.LoginPage),
        canActivate: [authGuard, userTypeGuard],
      },

      {
        path: 'profile/client',
        loadComponent: () =>
          import('../profiles/client-profile/client-profile.page').then(
            (m) => m.ClientProfilePage
          ),
        // canActivate: [authGuard], // Temporarily disabled for testing
      },

      // --- Many features disabled temporarily ---
      // {
      //   path: 'trainer-finder',
      //   loadComponent: () => import('../trainer-finder/trainer-finder.page').then(m => m.TrainerFinderPage),
      //   canActivate: [authGuard],
      // },

      // {
      //   path: 'chats',
      //   loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
      //   canActivate: [authGuard, userTypeGuard]
      // },

      // {
      //   path: 'calender',
      //   loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
      //   canActivate: [authGuard, userTypeGuard]
      // },

      // {
      //   path: 'account',
      //   loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
      //   canActivate: [authGuard, userTypeGuard]
      // },

      // ------------------------------------------

      // Default route inside /tabs
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
