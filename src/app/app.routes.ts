import { Routes } from '@angular/router';
import { authGuard } from './services/account/auth.guard';

export const routes: Routes = [
  // Auth pages
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'sign-up',
    loadComponent: () =>
      import('./pages/sign-up/sign-up.page').then((m) => m.SignUpPage),
  },
  {
    path: 'complete-profile',
    loadComponent: () =>
      import('./pages/complete-profile/complete-profile.page').then((m) => m.CompleteProfilePage),
    canActivate: [authGuard],
  },

  // Protected app shell
  {
    path: 'tabs',
    loadChildren: () =>
      import('./pages/tabs/tabs.routes').then((m) => m.routes),
    canActivate: [authGuard],
  },

  // Other pages (optional: protect these too if you want)
  {
    path: 'profile-user',
    loadComponent: () =>
      import('./pages/profile-user/profile-user.page').then((m) => m.ProfileUserPage),
    canActivate: [authGuard],
  },
  {
    path: 'groups',
    loadComponent: () =>
      import('./pages/groups/groups.page').then((m) => m.GroupsPage),
    canActivate: [authGuard],
  },
  {
  path: 'regional-leaderboard',
  loadComponent: () =>
    import('./pages/leaderboards/regional-leaderboard/regional-leaderboard.page')
      .then(m => m.RegionalLeaderboardPage),
  },
  {
    path: 'workout-details',
    loadComponent: () =>
      import('./pages/workout-details/workout-details.page').then((m) => m.WorkoutDetailsPage),
    canActivate: [authGuard],
  },
  {
    path: 'client-details',
    loadComponent: () =>
      import('./pages/client-details/client-details.page').then((m) => m.ClientDetailsPage),
  },
  {
    path: 'chat/:chatId',
    loadComponent: () =>
      import('./pages/chats/chat-detail/chat-detail.page').then((m) => m.ChatDetailPage),
  },
  {
    path: 'leaderboard/:groupID',
    loadComponent: () =>
      import('./pages/leaderboards/leaderboard/leaderboard.page').then((m) => m.LeaderboardPage),
    canActivate: [authGuard],
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  // If user manually types a bad URL → send to login
  {
    path: '**',
    redirectTo: 'login',
  }
];
