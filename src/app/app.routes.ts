import { Routes } from '@angular/router';
import { authGuard, userTypeGuard } from './services/account/auth.guard';

export const routes: Routes = [
  {
<<<<<<< HEAD
    path: '',
    redirectTo: 'sign-up',
    pathMatch: 'full'
  },
  {
    path: 'app',
    loadChildren: () => import('./pages/tabs/tabs.routes').then((m) => m.routes),
    canActivate: [authGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage)
  },
  {
    path: 'sign-up',
    loadComponent: () => import('./pages/sign-up/sign-up.page').then(m => m.SignUpPage)
  },
  {
    path: 'profile-creation',
    loadComponent: () => import('./pages/profile-creation/profile-creation.page').then(m => m.ProfileCreationPage),
    canActivate: [authGuard],
  },
  {
    path: 'profile-creation/trainer',
    loadComponent: () => import('./pages/profile-creation/profile-create-trainer/profile-create-trainer.page').then(m => m.ProfileCreateTrainerPage),
    canActivate: [authGuard],
  },
  {
    path: 'profile-creation/client',
    loadComponent: () => import('./pages/profile-creation/profile-create-client/profile-create-client.page').then(m => m.ProfileCreateClientPage),
    canActivate: [authGuard],
  },
  // Temporarily disabled - missing components
  // {
  //   path: 'chat/:chatId/:receiverId',
  //   loadComponent: () => import('./pages/chats/chat/chat.page').then(m => m.ChatPage),
  //   canActivate: [authGuard, userTypeGuard]
  // },
  // {
  //   path: 'chat/:chatId/:receiverId/:accountType',
  //   loadComponent: () => import('./pages/chats/chat/chat.page').then(m => m.ChatPage),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'service-agreements',
  //   loadComponent: () => import('./pages/service-agreements/service-agreements.page').then(m => m.ServiceAgreementsPage),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'service-agreement-creator',
  //   loadComponent: () => import('./pages/service-agreements/service-agreement-creator/service-agreement-creator.page').then(m => m.ServiceAgreementCreatorPage),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'trainer-info',
  //   loadComponent: () => import('./pages/trainer-info/trainer-info.page').then(m => m.TrainerInfoPage),
  //   canActivate: [authGuard]
  // },
  {
    path: 'client-profile',
    loadComponent: () => import('./pages/profiles/client-profile/client-profile.page').then( m => m.ClientProfilePage),
    // canActivate: [authGuard] // Temporarily disabled for testing
  },
  {
    path: 'client-profile/:userId',
    loadComponent: () => import('./pages/profiles/client-profile/client-profile.page').then( m => m.ClientProfilePage),
    // canActivate: [authGuard] // Temporarily disabled for testing
  },
  {
    path: 'leaderboard',
    loadComponent: () => import('./pages/leaderboard/leaderboard.component').then(m => m.LeaderboardComponent),
    // canActivate: [authGuard] // Temporarily disabled for testing
  },
  {
    path: 'workout-summary',
    loadComponent: () => import('./pages/workout-summary/workout-summary.page').then(m => m.WorkoutSummaryPage),
    // canActivate: [authGuard] // Temporarily disabled for testing
  },
  // Temporarily disabled - missing components
  // {
  //   path: 'payment-success',
  //   loadComponent: () => import('./pages/payment/payment-success/payment-success.component').then(m => m.PaymentSuccessComponent),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'payment-cancel',
  //   loadComponent: () => import('./pages/payment/payment-cancel/payment-cancel.component').then(m => m.PaymentCancelComponent),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'payment/:agreementId',
  //   loadComponent: () => import('./pages/payment/payment.page').then(m => m.PaymentPage),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'payment/success',
  //   redirectTo: '/app/tabs/home',
  //   pathMatch: 'full'
  // },
  // {
  //   path: 'session-booking',
  //   loadComponent: () => import('./pages/session-booking/session-booking.page').then( m => m.SessionBookingPage),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'session-booking/:trainerId',
  //   loadComponent: () => import('./pages/session-booking/session-booking.page').then( m => m.SessionBookingPage),
  //   canActivate: [authGuard]
  // },
  // {
  //   path: 'stripe-setup',
  //   loadComponent: () => import('./pages/stripe-setup/stripe-setup.page').then( m => m.StripeSetupPage),
  //   canActivate: [authGuard]
  // },
  {
    path: 'delete-account',
    loadComponent: () => import('./pages/delete-account/delete-account.page').then( m => m.DeleteAccountPage),
    canActivate: [authGuard]
  },
  //The receiverId is the id of the user you are messaging
  //{
  //  path: 'notes/:receiverId',
  //  loadComponent: () => import('./pages/notes/notes.page').then( m => m.NotesPage)
  //}
  // {
  //   path: 'trainer-finder',
  //   loadComponent: () => import('./pages/trainer-finder/trainer-finder.page').then( m => m.TrainerFinderPage)
  // },
  // {
  //   path: 'trainer-profile',
  //   loadComponent: () => import('./pages/trainer-profile/trainer-profile.page').then( m => m.TrainerProfilePage)
  // },
];

export const ROUTE_PATHS = {
  APP: {
    BASE: '/app',
    CHAT: '/chat',
    NOTES: '/notes',
    TABS: {
      BASE: '/app/tabs',
      HOME: '/app/tabs/home',
      PROFILE: '/app/tabs/trainer-profile',
      ACCOUNT: '/app/tabs/account',
      ACCOUNT_CLIENT: '/app/tabs/account/client',
      ACCOUNT_TRAINER: '/app/tabs/account/trainer',
      INFO: '/app/tabs/trainer-info',
      TRAINERS: '/app/tabs/trainer-finder',
      CHATS: '/app/tabs/chats',
      CALENDAR: '/app/tabs/calender',
      STRIPE_SETUP: '/app/tabs/stripe-setup',
      DELETE_ACCOUNT: '/app/tabs/delete-account',
      PAYMENT_HISTORY: '/app/tabs/payment-history'
    }
  },
  AUTH: {
    LOGIN: '/login',
    PROFILE_CREATION: '/profile-creation'
  },
  PAYMENT: {
    SUCCESS: '/payment-success',
    CANCEL: '/payment-cancel',
    PROCESS: (agreementId: string) => `/payment/${agreementId}`
  }
} as const;
=======
    path: 'workout-summary',
    loadComponent: () => import('./pages/workout-summary/workout-summary.page').then(m => m.WorkoutSummaryPage)
  },
  {
    path: 'groups',
    loadComponent: () => import('./pages/groups/groups.page').then(m => m.GroupsPage)
  },
  {
    path: 'workout-chatbot',
    loadComponent: () =>
      import('./pages/workout-chatbot/workout-chatbot.page').then(
        (m) => m.WorkoutChatbotPage
      ),
  },
  {
    path: '**',
    redirectTo: '/tabs/home',
    pathMatch: 'full'
  },
];
>>>>>>> feature/leader-board
