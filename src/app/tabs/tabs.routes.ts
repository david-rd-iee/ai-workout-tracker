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
<<<<<<< HEAD
        path: 'workout-summary',
        loadComponent: () => import('../pages/workout-summary/workout-summary.page').then((m) => m.WorkoutSummaryPage),
      },
      {
        path: 'client-profile',
        loadComponent: () => import('../pages/profiles/client-profile/client-profile.page').then((m) => m.ClientProfilePage),
      },
      {
        path: 'account',
        loadComponent: () => import('../pages/account/client-account/client-account.page').then((m) => m.ClientAccountPage),
=======
        path: 'groups',
        loadComponent: () => import('../pages/groups/groups.page').then(m => m.GroupsPage)
>>>>>>> feature/leader-board
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
