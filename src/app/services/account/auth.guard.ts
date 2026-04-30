import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import { inject } from '@angular/core';
import { Platform, ToastController } from '@ionic/angular';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { firstValueFrom, timer, type Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { Capacitor } from '@capacitor/core';
import { UserService } from './user.service';
import {
  STATUES_DASHBORD_ALLOWED_EMAIL,
  STATUES_DASHBORD_URL,
} from '../../pages/statues-dashbord/statues-dashbord.constants';

const authDecision = (): Observable<boolean | ReturnType<Router['createUrlTree']>> => {
  const accountService = inject(AccountService);
  const router = inject(Router);

  // wait until auth is ready, then decide once.
  return timer(0, 50).pipe(
    map(() => accountService.isAuthReady()()),
    filter((ready) => ready === true),
    take(1),
    map(() => {
      const loggedIn = accountService.isLoggedIn()();
      if (loggedIn) return true;
      return router.createUrlTree(['/login']);
    })
  );
};

export const authGuard: CanActivateFn = () => authDecision();

export const authChildGuard: CanActivateChildFn = () => authDecision();

export const authMatchGuard: CanMatchFn = () => authDecision();

export const demoModeGuard: CanActivateFn = async () => {
  const accountService = inject(AccountService);
  const userService = inject(UserService);
  const router = inject(Router);

  const user = await resolveCurrentUserProfile(accountService, userService);
  if (!user) {
    return router.createUrlTree(['/login']);
  }

  if (user.demoMode === true) {
    return router.createUrlTree(['/tabs/home']);
  }

  return true;
};

export const trainerOnlyGuard: CanActivateFn = async () => {
  const accountService = inject(AccountService);
  const userService = inject(UserService);
  const router = inject(Router);

  const user = await resolveCurrentUserProfile(accountService, userService);
  if (!user) {
    return router.createUrlTree(['/login']);
  }

  if (user.demoMode === true || user.accountType !== 'trainer') {
    return router.createUrlTree(['/tabs/home']);
  }

  return true;
};

export const clientPaymentsGuard: CanActivateFn = async () => {
  const accountService = inject(AccountService);
  const router = inject(Router);
  const firestore = inject(Firestore);
  const toastController = inject(ToastController);
  const userService = inject(UserService);

  await waitForAuthReady(accountService);

  if (!accountService.isLoggedIn()()) {
    return router.createUrlTree(['/login'], {
      queryParams: {
        redirectTo: '/client-payments',
      },
    });
  }

  const uid = normalizeString(accountService.getCredentials()().uid);
  if (!uid) {
    return router.createUrlTree(['/login'], {
      queryParams: {
        redirectTo: '/client-payments',
      },
    });
  }

  await resolveCurrentUserProfile(accountService, userService);
  try {
    const [usersSnap, clientProfileSnap] = await Promise.all([
      getDoc(doc(firestore, `users/${uid}`)),
      getDoc(doc(firestore, `clients/${uid}`)),
    ]);

    const usersData = usersSnap.exists() ? toRecord(usersSnap.data()) : {};
    const clientProfileData = clientProfileSnap.exists() ? toRecord(clientProfileSnap.data()) : {};

    if (usersData['isPT'] === true) {
      await presentGuardToast(
        toastController,
        'Client payments are only available for client accounts.'
      );
      return router.createUrlTree(['/tabs/home']);
    }

    const trainerId =
      resolveClientAssignedTrainerId(usersData) ||
      resolveClientAssignedTrainerId(clientProfileData);

    if (!trainerId) {
      await presentGuardToast(
        toastController,
        'Connect with a trainer first to access client payments.'
      );
      return router.createUrlTree(['/client-find-trainer']);
    }

    return true;
  } catch (error) {
    console.error('[clientPaymentsGuard] Failed to validate client payments access:', error);
    await presentGuardToast(
      toastController,
      'Unable to verify trainer connection right now. Please try again.'
    );
    return router.createUrlTree(['/tabs/home']);
  }
};

const devDashboardDecision = (
  targetUrl: string
): Observable<boolean | ReturnType<Router['createUrlTree']>> => {
  const accountService = inject(AccountService);
  const router = inject(Router);
  const platform = inject(Platform);

  return timer(0, 50).pipe(
    map(() => accountService.isAuthReady()()),
    filter((ready) => ready === true),
    take(1),
    map(() => {
      const loginTree = (authError?: string) =>
        router.createUrlTree(['/login'], {
          queryParams: {
            redirectTo: targetUrl || STATUES_DASHBORD_URL,
            ...(authError ? { authError } : {}),
          },
        });

      if (Capacitor.isNativePlatform() || platform.is('iphone')) {
        return loginTree('This page is only available in the web browser.');
      }

      if (!accountService.isLoggedIn()()) {
        return loginTree();
      }

      const currentEmail = accountService.getCredentials()().email.trim().toLowerCase();
      if (currentEmail !== STATUES_DASHBORD_ALLOWED_EMAIL) {
        return loginTree(`Sign in with ${STATUES_DASHBORD_ALLOWED_EMAIL} to access this page.`);
      }

      return true;
    })
  );
};

export const statuesDashbordGuard: CanActivateFn = (_route, state) =>
  devDashboardDecision(state.url || STATUES_DASHBORD_URL);

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function waitForAuthReady(accountService: AccountService): Promise<void> {
  if (accountService.isAuthReady()()) {
    return;
  }

  await firstValueFrom(
    timer(0, 50).pipe(
      map(() => accountService.isAuthReady()()),
      filter((ready) => ready === true),
      take(1)
    )
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function resolveClientAssignedTrainerId(clientData: Record<string, unknown>): string {
  return normalizeString(clientData['trainerID']) || normalizeString(clientData['trainerId']);
}

async function presentGuardToast(toastController: ToastController, message: string): Promise<void> {
  const toast = await toastController.create({
    message,
    duration: 2200,
    position: 'top',
    color: 'warning',
  });
  await toast.present();
}

async function resolveCurrentUserProfile(
  accountService: AccountService,
  userService: UserService
): Promise<{ accountType?: string; demoMode?: boolean } | null> {
  await waitForAuthReady(accountService);
  if (!accountService.isLoggedIn()()) {
    return null;
  }

  try {
    await userService.loadUserProfile();
  } catch (error) {
    console.error('[auth.guard] Failed to load current user profile:', error);
  }

  return userService.getUserInfo()();
}
