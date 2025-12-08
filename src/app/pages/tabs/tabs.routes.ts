import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('../home/home.page').then(m => m.HomePage),
      },
      {
        path: 'groups',
        loadComponent: () =>
          import('../groups/groups.page').then(m => m.GroupsPage),
      },
      {
        path: 'leaderboard',
        loadComponent: () =>
          import('../leaderboard/leaderboard.component').then(m => m.LeaderboardComponent),
      },
      {
        path: 'chats',
        loadComponent: () =>
          import('../workout-chatbot/workout-chatbot.page').then((m) => m.WorkoutChatbotPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('../profiles/client-profile/client-profile.page').then(m => m.ClientProfilePage),
      },

      // default inside /tabs → /tabs/home
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
    ],
  },
];
