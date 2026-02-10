import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'tabs',
    loadChildren: () =>
      import('./pages/tabs/tabs.routes').then((m) => m.routes),
  },
  {
    path: 'workout-details',
    loadComponent: () =>
      import('./pages/workout-details/workout-details.page').then((m) => m.WorkoutDetailsPage),
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
