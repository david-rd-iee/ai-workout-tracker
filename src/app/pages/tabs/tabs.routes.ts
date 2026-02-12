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
        path: 'calender',
        loadComponent: () =>
          import('../calender/client-calendar/client-calendar.page').then(m => m.ClientCalendarPage),
      },
      {
        path: 'chats',
        loadComponent: () =>
          import('../chats/chats.page').then(m => m.ChatsPage),
        children: [
          {
            path: 'client-chats',
            loadComponent: () =>
              import('../chats/client-chats/client-chats.page').then(m => m.ClientChatsPage),
          },
          {
            path: 'groups',
            loadComponent: () =>
              import('../groups/groups.page').then(m => m.GroupsPage),
          },
          {
            path: 'workout-chatbot',
            loadComponent: () =>
              import('../workout-chatbot/workout-chatbot.page').then(m => m.WorkoutChatbotPage),
          },
          {
            path: '',
            redirectTo: 'client-chats',
            pathMatch: 'full',
          },
        ],
      },
      {
        path: 'leaderboard',
        loadComponent: () =>
          import('../leaderboard/leaderboard.component').then(m => m.LeaderboardComponent),
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
