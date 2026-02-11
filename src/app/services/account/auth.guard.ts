import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import { inject } from '@angular/core';

export const authGuard: CanActivateFn = (route, state) => {
  const accountService = inject(AccountService);
  const router = inject(Router);

  // Wait for auth initialization to avoid flash redirects
  const ready = accountService.isAuthReady()();
  if (!ready) {
    // If not ready, block navigation momentarily by redirecting to login
    // (simple approach; we can improve later with a loading screen)
    router.navigate(['/login']);
    return false;
  }

  const loggedIn = accountService.isLoggedIn()(); // <-- IMPORTANT

  if (loggedIn) return true;

  router.navigate(['/login']);
  return false;
};
