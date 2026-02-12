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
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  // If user manually types a bad URL → send to login
  {
    path: '**',
    redirectTo: 'login',
  },
];
