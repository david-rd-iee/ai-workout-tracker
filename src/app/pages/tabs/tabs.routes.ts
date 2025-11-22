import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';
import { authGuard, userTypeGuard } from '../../services/account/auth.guard';
import { UserService } from 'src/app/services/account/user.service';
import { inject } from '@angular/core';


export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('../home/home.page').then((m) => m.HomePage),
        canActivate: [authGuard],

      },
      {
        path: 'trainer-finder',
        loadComponent: () => import('../trainer-finder/trainer-finder.page').then(m => m.TrainerFinderPage),
        canActivate: [authGuard],
      },
      {
        path: 'profile',
        loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
        canActivate: [authGuard, userTypeGuard]
      },
      {
        path: 'profile/client',
        loadComponent: () => import('../profiles/client-profile/client-profile.page').then(m => m.ClientProfilePage),
        canActivate: [authGuard],
      },
      {
        path: 'profile/trainer',
        loadComponent: () => import('../profiles/trainer-profile/trainer-profile.page').then(m => m.TrainerProfilePage),
        canActivate: [authGuard],
      },
      {
        path: 'chats',
        loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
        canActivate: [authGuard, userTypeGuard]
      },
      {
        path: 'chats/trainer',
        loadComponent: () => import('../chats/trainer-chats/trainer-chats.page').then(m => m.TrainerChatsPage),
        canActivate: [authGuard],
      },
      {
        path: 'chats/client',
        loadComponent: () => import('../chats/client-chats/client-chats.page').then(m => m.ClientChatsPage),
        canActivate: [authGuard],
      },
      {
        path: 'service-agreement-creator',
        loadComponent: () => import('../../pages/service-agreements/service-agreement-creator/service-agreement-creator.page').then( m => m.ServiceAgreementCreatorPage)
      },
      {
        path: 'calender',
        loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
        canActivate: [authGuard, userTypeGuard]
      },
      {
        path: 'calender/trainer',
        loadComponent: () => import('../../pages/calender/trainer-calendar/trainer-calendar.page').then( m => m.TrainerCalendarPage),
        canActivate: [authGuard]
      },
      {
        path: 'calender/client',
        loadComponent: () => import('../../pages/calender/client-calendar/client-calendar.page').then( m => m.ClientCalendarPage),
        canActivate: [authGuard]
      },
      {
        path: 'account',
        loadComponent: () => import('../../pages/login/login.page').then( m => m.LoginPage),
        canActivate: [authGuard, userTypeGuard]
      },
      {
        path: 'account/trainer',
        loadComponent: () => import('../../pages/account/trainer-account/trainer-account.page').then( m => m.AccountPage),
        canActivate: [authGuard]
      },
      {
        path: 'account/client',
        loadComponent: () => import('../../pages/account/client-account/client-account.page').then( m => m.ClientAccountPage),
        canActivate: [authGuard]
      },
      {
        path: 'trainer-info/:id',
        loadComponent: () => import('../../pages/trainer-info/trainer-info.page').then( m => m.TrainerInfoPage),
        canActivate: [authGuard]
      },
      {
        path: 'stripe-setup',
        loadComponent: () => import('../../pages/stripe-setup/stripe-setup.page').then( m => m.StripeSetupPage),
        canActivate: [authGuard]
      },
      {
        path: 'payment-history',
        loadComponent: () => import('../../pages/payment-history/payment-history.component').then( m => m.PaymentHistoryComponent),
        canActivate: [authGuard]
      },
      {
        path: '',
        redirectTo: '/app/tabs/home',
        pathMatch: 'full'
      }
    ],
  },

];
