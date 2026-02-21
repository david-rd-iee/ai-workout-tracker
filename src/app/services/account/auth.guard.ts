import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import { inject } from '@angular/core';
import { timer } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (_route, state) => {
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