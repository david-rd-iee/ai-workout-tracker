import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel,
} from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import {
  homeOutline,
  calendarOutline,
  chatbubbleEllipsesSharp,
} from 'ionicons/icons';
import { filter } from 'rxjs/operators';
import { UserService } from '../../services/account/user.service';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Region } from '../../models/user-stats.model';

@Component({
  selector: 'app-tabs',
  standalone: true,
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  imports: [
    CommonModule,
    IonTabs,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
  ],
})
export class TabsPage implements OnDestroy {
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth, { optional: true });
  private readonly firestore = inject(Firestore, { optional: true });

  private authUnsubscribe: (() => void) | null = null;
  private isResolvingRegion = false;

  showTabBar = true;
  calendarHref = '/tabs/calender/client';
  currentUrl = '';

  constructor() {
    addIcons({
      homeOutline,
      calendarOutline,
      chatbubbleEllipsesSharp,
    });

    this.currentUrl = this.router.url;
    this.updateTabBarVisibility(this.router.url);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const nav = event as NavigationEnd;
        this.currentUrl = nav.urlAfterRedirects;
        this.updateTabBarVisibility(nav.urlAfterRedirects);
        this.updateCalendarHref(nav.urlAfterRedirects);
      });

    this.updateCalendarHref(this.router.url);
    this.startRegionPromptWatcher();
  }

  ngOnDestroy(): void {
    this.authUnsubscribe?.();
    this.authUnsubscribe = null;
  }

  private updateTabBarVisibility(url: string): void {
    this.showTabBar = !url.includes('/workout-chatbot');
  }

  private updateCalendarHref(url: string): void {
    if (url.includes('/tabs/calender/trainer')) {
      this.calendarHref = '/tabs/calender/trainer';
      return;
    }

    if (url.includes('/tabs/calender/client')) {
      this.calendarHref = '/tabs/calender/client';
      return;
    }

    const userProfile = this.userService.getUserInfo()();
    this.calendarHref = userProfile?.accountType === 'trainer'
      ? '/tabs/calender/trainer'
      : '/tabs/calender/client';
  }

  onCalendarTabClick(event: Event): void {
    const isOnCalendar =
      this.currentUrl.includes('/tabs/calender/client') ||
      this.currentUrl.includes('/tabs/calender/trainer') ||
      this.currentUrl.endsWith('/tabs/calender') ||
      this.currentUrl.endsWith('/tabs/calender/');

    event.preventDefault();
    event.stopPropagation();

    if (isOnCalendar) {
      return;
    }

    void this.router.navigateByUrl(this.calendarHref);
  }

  private startRegionPromptWatcher(): void {
    if (!this.auth || !this.firestore) {
      return;
    }

    this.authUnsubscribe = onAuthStateChanged(this.auth, (user) => {
      if (!user?.uid) {
        return;
      }

      void this.ensureRegionIsConfigured(user.uid);
    });
  }

  private async ensureRegionIsConfigured(userId: string): Promise<void> {
    if (!this.firestore || !('geolocation' in navigator)) {
      return;
    }

    if (this.isResolvingRegion) {
      return;
    }

    try {
      const userStatsRef = doc(this.firestore, 'userStats', userId);
      const userStatsSnap = await getDoc(userStatsRef);
      const rawRegion = (userStatsSnap.data()?.['region'] ?? null) as Record<string, unknown> | null;

      if (this.hasRequiredRegionFields(rawRegion)) {
        return;
      }

      this.isResolvingRegion = true;
      const position = await this.getCurrentPosition();
      const region = await this.reverseGeocodeRegion(
        position.coords.latitude,
        position.coords.longitude
      );
      if (!region) {
        return;
      }

      await setDoc(
        doc(this.firestore, 'userStats', userId),
        {
          region,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[TabsPage] Failed to verify user region:', error);
    } finally {
      this.isResolvingRegion = false;
    }
  }

  private hasRequiredRegionFields(region: Record<string, unknown> | null): boolean {
    const countryCode = this.normalizeCode(region?.['countryCode'], 2);
    const stateCode = this.normalizeCode(region?.['stateCode'], 2);
    const cityId = this.normalizeCityIdText(region?.['cityId']);
    return !!countryCode && !!stateCode && this.isValidCityId(cityId, stateCode, countryCode);
  }

  private getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });
    });
  }

  private async reverseGeocodeRegion(
    latitude: number,
    longitude: number
  ): Promise<Region | null> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const endpoint = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    endpoint.searchParams.set('latitude', String(latitude));
    endpoint.searchParams.set('longitude', String(longitude));
    endpoint.searchParams.set('localityLanguage', 'en');

    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as Record<string, unknown>;
    const countryCode = this.normalizeCode(payload['countryCode'], 2);
    const countryName = this.normalizeText(payload['countryName']) || countryCode;
    const stateName = this.normalizeText(payload['principalSubdivision']);
    const stateCode = this.normalizeStateCode(payload['principalSubdivisionCode']);
    const cityName = this.resolveCityName(payload);
    const cityId = this.buildCityId(cityName, stateCode, countryCode);

    if (!countryCode || !stateCode || !cityName || !cityId) {
      return null;
    }

    return {
      country: countryCode,
      state: stateCode,
      city: cityName,
      countryCode,
      stateCode,
      cityId,
      countryName,
      stateName: stateName || stateCode,
      cityName,
    };
  }

  private resolveCityName(payload: Record<string, unknown>): string {
    const candidates = [
      payload['city'],
      payload['locality'],
      payload['principalSubdivision'],
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeText(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private normalizeStateCode(value: unknown): string {
    const raw = this.normalizeText(value).toUpperCase();
    const usMatch = raw.match(/^US-([A-Z]{2})$/);
    if (usMatch?.[1]) {
      return usMatch[1];
    }

    const fallback = raw.match(/([A-Z]{2})$/);
    return fallback?.[1] ?? '';
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private normalizeCode(value: unknown, expectedLength: number): string {
    const normalized = this.normalizeText(value)
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    return normalized.length === expectedLength ? normalized : '';
  }

  private normalizeCityIdText(value: unknown): string {
    return this.normalizeText(value)
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private normalizeCityNameForCityId(value: unknown): string {
    const normalized = this.normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
    return normalized;
  }

  private buildCityId(cityName: string, stateCode: string, countryCode: string): string {
    const normalizedCity = this.normalizeCityNameForCityId(cityName);
    const normalizedState = this.normalizeText(stateCode).toLowerCase();
    const normalizedCountry = countryCode.toUpperCase() === 'US'
      ? 'usa'
      : this.normalizeText(countryCode).toLowerCase();

    if (!normalizedCity || !normalizedState || !normalizedCountry) {
      return '';
    }

    return `${normalizedCity}_${normalizedState}_${normalizedCountry}`;
  }

  private isValidCityId(cityId: string, stateCode: string, countryCode: string): boolean {
    if (!cityId || !stateCode || !countryCode) {
      return false;
    }

    const normalizedId = this.normalizeCityIdText(cityId);
    const parts = normalizedId.split('_').filter(Boolean);
    if (parts.length !== 3) {
      return false;
    }

    const cityPart = parts[0];
    const statePart = parts[1];
    const countryPart = parts[2];
    const expectedState = stateCode.toLowerCase();
    const expectedCountry = countryCode.toUpperCase() === 'US'
      ? 'usa'
      : countryCode.toLowerCase();

    return (
      /^[a-z0-9]+$/.test(cityPart) &&
      statePart === expectedState &&
      countryPart === expectedCountry
    );
  }
}
