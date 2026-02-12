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
    path: 'workout-details',
    loadComponent: () =>
      import('./pages/workout-details/workout-details.page').then((m) => m.WorkoutDetailsPage),
    canActivate: [authGuard],
  },
  {
  path: 'regional-leaderboard',
  loadComponent: () =>
    import('./pages/leaderboards/regional-leaderboard/regional-leaderboard.page')
      .then(m => m.RegionalLeaderboardPage),
},


  // Default: go to login first
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  // Catch-all
  { path: '**', redirectTo: 'login' },
  {
    path: 'regional-leaderboard',
    loadComponent: () => import('./pages/leaderboards/regional-leaderboard/regional-leaderboard.page').then( m => m.RegionalLeaderboardPage)
  },
];
