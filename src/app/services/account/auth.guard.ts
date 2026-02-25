import { CanActivateChildFn, CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import { inject } from '@angular/core';
import { timer, type Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

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
