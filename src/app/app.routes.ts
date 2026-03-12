import { Routes } from '@angular/router';
import { authChildGuard, authGuard, authMatchGuard } from './services/account/auth.guard';

// Route paths constant for type-safe navigation
export const ROUTE_PATHS = {
  APP: {
    TABS: {
      HOME: '/tabs/home',
      STRIPE_SETUP: '/tabs/stripe-setup',
      ACCOUNT: '/tabs/account',
      CALENDAR: '/tabs/calendar',
      PROFILE: '/tabs/profile'
    }
  },
  AUTH: {
    LOGIN: '/login',
    SIGN_UP: '/sign-up',
    COMPLETE_PROFILE: '/complete-profile'
  }
} as const;

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
  {
    path: 'profile-creation',
    loadComponent: () =>
      import('./pages/profile-creation/profile-creation.page').then((m) => m.ProfileCreationPage),
    canActivate: [authGuard],
  },
  {
    path: 'profile-creation/trainer',
    loadComponent: () =>
      import('./pages/profile-creation/profile-create-trainer/profile-create-trainer.page').then(
        (m) => m.ProfileCreateTrainerPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'profile-creation/client',
    loadComponent: () =>
      import('./pages/profile-creation/profile-create-client/profile-create-client.page').then(
        (m) => m.ProfileCreateClientPage
      ),
    canActivate: [authGuard],
  },

  // Protected app shell
  {
    path: 'tabs',
    loadChildren: () =>
      import('./pages/tabs/tabs.routes').then((m) => m.routes),
    canMatch: [authMatchGuard],
    canActivate: [authGuard],
    canActivateChild: [authChildGuard],
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
  canActivate: [authGuard],
  },
  {
    path: 'workout-details',
    loadComponent: () =>
      import('./pages/workout-details/workout-details.page').then((m) => m.WorkoutDetailsPage),
    canActivate: [authGuard],
  },
  {
    path: 'workout-chatbot',
    loadComponent: () =>
      import('./pages/workout-chatbot/workout-chatbot.page').then(
        (m) => m.WorkoutChatbotPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'workout-summary',
    loadComponent: () =>
      import('./pages/workout-summary/workout-summary.page').then(
        (m) => m.WorkoutSummaryPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'client-details',
    loadComponent: () =>
      import('./pages/client-details/client-details.page').then((m) => m.ClientDetailsPage),
    canActivate: [authGuard],
  },
  {
    path: 'chat/:chatId',
    loadComponent: () =>
      import('./pages/chats/chat-detail/chat-detail.page').then((m) => m.ChatDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'leaderboard/:groupID',
    loadComponent: () =>
      import('./pages/leaderboards/leaderboard/leaderboard.page').then((m) => m.LeaderboardPage),
    canActivate: [authGuard],
  },
  {
    path: 'group-settings/:groupID',
    loadComponent: () =>
      import('./pages/group-settings/group-settings.page').then((m) => m.GroupSettingsPage),
    canActivate: [authGuard],
  },
  {
    path: 'user-settings',
    loadComponent: () =>
      import('./pages/profile-settings/profile-settings.page').then((m) => m.ProfileSettingsPage),
    canActivate: [authGuard],
  },
  {
    path: 'client-find-trainer',
    loadComponent: () =>
      import('./pages/client-find-trainer/client-find-trainer.page').then(
        (m) => m.ClientFindTrainerPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'profile-settings',
    redirectTo: 'user-settings',
    pathMatch: 'full',
  },
  {
    path: 'camera',
    loadComponent: () => import('./pages/camera/camera.page').then((m) => m.CameraPage),
    canActivate: [authGuard],
  },
  {
    path: 'workout-history',
    loadComponent: () =>
      import('./pages/workout-history/workout-history.page').then(
        (m) => m.WorkoutHistoryPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'workout-history-csv',
    loadComponent: () =>
      import('./pages/workout-history-csv/workout-history-csv.page').then(
        (m) => m.WorkoutHistoryCsvPage
      ),
  },
  {
    path: 'workout-insights',
    loadComponent: () =>
      import('./pages/workout-insights/workout-insights.page').then((m) => m.WorkoutInsightsPage),
    canActivate: [authGuard],
  },
  {
    path: 'live-session',
    loadComponent: () =>
      import('./pages/live-session/live-session.page').then((m) => m.LiveSessionPage),
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
