import { Injectable, OnDestroy, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  OrientationLockType,
  ScreenOrientation,
} from '@capacitor/screen-orientation';
import { Subscription, filter } from 'rxjs';
import {
  ALLOW_LANDSCAPE_ORIENTATION_POLICY,
  DEFAULT_ROUTE_ORIENTATION_POLICY,
  ORIENTATION_POLICY_ROUTE_DATA_KEY,
  RouteOrientationPolicy,
} from './orientation-policy';

@Injectable({ providedIn: 'root' })
export class OrientationPolicyService implements OnDestroy {
  private readonly router = inject(Router);

  private navigationSub?: Subscription;
  private started = false;
  private lastAppliedLockType: OrientationLockType | null = null;

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    this.navigationSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        void this.applyPolicyForCurrentRoute();
      });

    void this.applyPolicyForCurrentRoute();
  }

  ngOnDestroy(): void {
    this.navigationSub?.unsubscribe();
  }

  private async applyPolicyForCurrentRoute(): Promise<void> {
    const routePolicy = this.resolvePolicyFromSnapshot(this.router.routerState.snapshot.root);
    const lockType: OrientationLockType =
      routePolicy === ALLOW_LANDSCAPE_ORIENTATION_POLICY
        ? 'any'
        : 'portrait';

    if (this.lastAppliedLockType === lockType) {
      return;
    }

    try {
      await ScreenOrientation.lock({ orientation: lockType });
      this.lastAppliedLockType = lockType;
    } catch (error) {
      console.error('[OrientationPolicyService] Failed to apply orientation policy:', {
        routePolicy,
        lockType,
        error,
      });
    }
  }

  private resolvePolicyFromSnapshot(snapshot: ActivatedRouteSnapshot): RouteOrientationPolicy {
    let resolvedPolicy: RouteOrientationPolicy = DEFAULT_ROUTE_ORIENTATION_POLICY;
    let cursor: ActivatedRouteSnapshot | null = snapshot;

    while (cursor) {
      const routePolicy = cursor.data[ORIENTATION_POLICY_ROUTE_DATA_KEY];
      if (
        routePolicy === ALLOW_LANDSCAPE_ORIENTATION_POLICY ||
        routePolicy === DEFAULT_ROUTE_ORIENTATION_POLICY
      ) {
        resolvedPolicy = routePolicy;
      }

      cursor = cursor.firstChild ?? null;
    }

    return resolvedPolicy;
  }
}
