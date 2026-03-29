import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import { inject } from '@angular/core';
import { Platform } from '@ionic/angular';
import { timer, type Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { Capacitor } from '@capacitor/core';
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
