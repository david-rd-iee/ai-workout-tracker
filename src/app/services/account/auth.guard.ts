import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { AccountService } from './account.service';
import { inject } from '@angular/core';
import { UserService } from './user.service';


export const authGuard: CanActivateFn = (route, state) => {
  const accountService = inject(AccountService);

  const router = inject(Router);
  if (accountService.isLoggedIn()) {
    return true;
  } else {
    router.navigate(['/login']);
    return false;
  }
  
};

export const userTypeGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const userService = inject(UserService);
  const accountService = inject(AccountService);
  const router = inject(Router);
  
  // Check if user is logged in and auth is ready
  if (!accountService.isLoggedIn()() || !accountService.isAuthReady()()) {
    router.navigate(['/login']);
    return false;
  }

  const userType = userService.getUserInfo()()?.accountType;
  const targetUrl = state.url;

  console.log('UserTypeGuard - Current user type:', userType);

  if (!userType) {
    console.log('No user type found, redirecting to profile creation');
    router.navigate(['/profile-creation']);
    return false;
  }

  if (userType === 'trainer') {
    console.log('Redirecting trainer to:', `${targetUrl}/trainer`);
    router.navigate([targetUrl, "trainer"]);
    return false;
  } else if (userType === 'client') {
    console.log('Redirecting client to:', `${targetUrl}/client`);
    router.navigate([targetUrl, "client"]);
    return false;
  }

  return false;
};