import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonAvatar,
  IonButton,
  IonCard,
  IonContent,
  IonIcon,
  IonList,
  IonSelect,
  IonSelectOption,
  IonSpinner } from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import { arrowBackOutline, caretDownOutline } from 'ionicons/icons';

import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import { FormsModule } from '@angular/forms';

import { LeaderboardService, LeaderboardEntry, Metric } from '../../../services/leaderboard.service';

type RegionScope = 'city' | 'state' | 'country';

@Component({
  selector: 'app-regional-leaderboard',
  standalone: true,
  templateUrl: './regional-leaderboard.page.html',
  styleUrls: ['./regional-leaderboard.page.scss'],
  imports: [CommonModule,
    FormsModule,
    IonContent,
    IonButton,
    IonIcon,
    IonCard,
    IonSelect,
    IonSelectOption,
    IonList,
    IonAvatar,
    IonSpinner,
  ],
})
export class RegionalLeaderboardPage implements OnInit, OnDestroy {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private leaderboard = inject(LeaderboardService);
  private router = inject(Router);

  private sub?: Subscription;

  loading = true;
  errorMsg = '';

  authUser: User | null = null;

  // Anchor region (from current user's userStats)
  userRegion: any = null;

  // UI controls
  scope: RegionScope = 'city';
  metric: Metric = 'total';
  roleFilter: 'ALL' | 'TRAINER' | 'USER' = 'ALL';

  // Data
  entries: LeaderboardEntry[] = [];

  constructor() {
    addIcons({ arrowBackOutline, caretDownOutline });
  }

  ngOnInit() {
    onAuthStateChanged(this.auth, (u) => {
      this.authUser = u;
      if (!u) {
        this.loading = false;
        this.errorMsg = 'Not signed in.';
        return;
      }

      // Subscribe to current user's userStats so region is always current
      const statsRef = doc(this.firestore, 'userStats', u.uid);
      this.sub?.unsubscribe();
      this.sub = docData(statsRef).subscribe({
        next: (stats: any) => {
          this.userRegion = stats?.region ?? null;
          this.refresh();
        },
        error: (err) => {
          console.warn('[RegionalLeaderboard] userStats read failed', err);
          this.loading = false;
          this.errorMsg = 'Failed to load your region.';
        },
      });
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async refresh() {
    this.errorMsg = '';

    if (!this.authUser) return;
    if (!this.userRegion?.countryCode) {
      this.loading = false;
      this.entries = [];
      this.errorMsg = 'Your userStats.region is missing (countryCode).';
      return;
    }

    this.loading = true;

    try {
      const regional =
        this.scope === 'country'
          ? {
              scope: 'country' as const,
              countryCode: this.userRegion.countryCode,
            }
          : this.scope === 'state'
          ? {
              scope: 'state' as const,
              countryCode: this.userRegion.countryCode,
              stateCode: this.userRegion.stateCode,
            }
          : {
              scope: 'city' as const,
              countryCode: this.userRegion.countryCode,
              stateCode: this.userRegion.stateCode,
              cityId: this.userRegion.cityId,
            };

      const raw = await this.leaderboard.getRegionalLeaderboard(regional, this.metric, 100);

      // Role filter (local, because you already have the rows)
      const filtered =
        this.roleFilter === 'ALL'
          ? raw
          : raw.filter((e) => (e.role ?? 'USER') === this.roleFilter);

      this.entries = filtered;
    } catch (err: any) {
      console.warn('[RegionalLeaderboard] refresh failed', err);
      this.errorMsg =
        err?.message ??
        'Failed to load regional leaderboard (check indexes + region fields).';
      this.entries = [];
    } finally {
      this.loading = false;
    }
  }

  goBack() {
    this.router.navigateByUrl('/tabs/home'); // change if your back target differs
  }

  regionLabel(): string {
    if (!this.userRegion) return 'Region';

    const country = this.userRegion.countryName || this.userRegion.countryCode;
    const state = this.userRegion.stateName || this.userRegion.stateCode;
    const city = this.userRegion.cityName || this.userRegion.cityId;

    if (this.scope === 'country') return `${country}`;
    if (this.scope === 'state') return `${state}, ${country}`;
    return `${city}, ${state}`;
  }

  metricLabel(): string {
    if (this.metric === 'cardio') return 'Cardio';
    if (this.metric === 'strength') return 'Strength';
    return 'Total';
  }

  scoreFor(e: LeaderboardEntry): number {
    if (this.metric === 'cardio') return e.cardioWorkScore ?? 0;
    if (this.metric === 'strength') return e.strengthWorkScore ?? 0;
    return e.totalWorkScore ?? 0;
  }
}
