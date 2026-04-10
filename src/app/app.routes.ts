import { Routes } from '@angular/router';
import {
  authChildGuard,
  authGuard,
  authMatchGuard,
  statuesDashbordGuard,
} from './services/account/auth.guard';
import {
  STATUES_DASHBORD_ROUTE_PATH,
  STATUES_DASHBOARD_ALIAS_ROUTE_PATH,
} from './pages/statues-dashbord/statues-dashbord.constants';

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
    path: 'statues/:id',
    loadComponent: () =>
      import('./pages/statue-detail/statue-detail.page').then((m) => m.StatueDetailPage),
    canActivate: [authGuard],
  },
  {
    path: 'groups',
    loadComponent: () =>
      import('./pages/groups/groups.page').then((m) => m.GroupsPage),
    canActivate: [authGuard],
  },
  {
    path: 'group-wars/leaderboard',
    loadComponent: () =>
      import('./pages/group-wars/global-group-leaderboard/global-group-leaderboard.page').then(
        (m) => m.GlobalGroupLeaderboardPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'group-wars/recap/:warId',
    loadComponent: () =>
      import('./pages/group-wars/group-war-recap/group-war-recap.page').then(
        (m) => m.GroupWarRecapPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'group-wars/:groupId',
    loadComponent: () =>
      import('./pages/group-wars/group-war/group-war.page').then((m) => m.GroupWarPage),
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
    path: 'logging-method-routes',
    loadComponent: () =>
      import('./pages/logging-method-routes/logging-method-routes.page').then(
        (m) => m.LoggingMethodRoutesPage
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
    path: 'analyzed-videos',
    loadComponent: () =>
      import('./pages/analyzed-videos/analyzed-videos.page').then((m) => m.AnalyzedVideosPage),
    canActivate: [authGuard],
  },
  {
    path: 'client-analyzed-video/:analysisId',
    loadComponent: () =>
      import('./pages/client-analyzed-video/client-analyzed-video.page').then(
        (m) => m.ClientAnalyzedVideoPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'client-workout-analysis',
    loadComponent: () =>
      import('./pages/client-workout-analysis/client-workout-analysis.page').then(
        (m) => m.ClientWorkoutAnalysisPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'trainer-workout-analyzer/:clientId',
    loadComponent: () =>
      import('./pages/trainer-workout-analyzer/trainer-workout-analyzer.page').then(
        (m) => m.TrainerWorkoutAnalyzerPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'treadmill-logger',
    loadComponent: () =>
      import('./pages/treadmill-logger/treadmill-logger.page').then(
        (m) => m.TreadmillLoggerPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'trwadmill-logger',
    redirectTo: 'treadmill-logger',
    pathMatch: 'full',
  },
  {
    path: 'map-tracking-logger',
    loadComponent: () =>
      import('./pages/map-tracking-logger/map-tracking-logger.page').then(
        (m) => m.MapTrackingLoggerPage
      ),
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
    path: STATUES_DASHBORD_ROUTE_PATH,
    loadComponent: () =>
      import('./pages/statues-dashbord/statues-dashbord.page').then(
        (m) => m.StatuesDashbordPage
      ),
    canActivate: [statuesDashbordGuard],
  },
  {
    path: STATUES_DASHBOARD_ALIAS_ROUTE_PATH,
    redirectTo: STATUES_DASHBORD_ROUTE_PATH,
    pathMatch: 'full',
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
