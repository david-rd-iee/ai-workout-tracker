import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonSkeletonText,
} from '@ionic/angular/standalone';
import { Auth } from '@angular/fire/auth';
import { GreekStatueComponent } from '../../components/greek-statue/greek-statue.component';
import { HeaderComponent } from '../../components/header/header.component';
import { GreekStatuesService } from '../../services/greek-statues.service';
import { UserBadgesService } from '../../services/user-badges.service';
import {
  GreekStatue,
  GreekStatueDefinition,
  STATUE_TIER_CONFIG,
  isCarvedStatueLevel,
  normalizeStatueLevel,
} from '../../models/greek-statue.model';
import { UserBadgeStatDoc, UserBadgeStatsMap } from '../../models/user-badges.model';

@Component({
  selector: 'app-statue-detail',
  standalone: true,
  templateUrl: './statue-detail.page.html',
  styleUrls: ['./statue-detail.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonBadge,
    IonList,
    IonItem,
    IonLabel,
    IonSkeletonText,
    GreekStatueComponent,
    HeaderComponent,
  ],
})
export class StatueDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(Auth);
  private readonly greekStatuesService = inject(GreekStatuesService);
  private readonly userBadgesService = inject(UserBadgesService);

  isLoading = true;
  errorMessage = '';
  statue: GreekStatue | null = null;

  async ngOnInit(): Promise<void> {
    const statueId = (this.route.snapshot.paramMap.get('id') || '').trim();
    await this.loadStatue(statueId);
  }

  get stageDisplayName(): string {
    if (!isCarvedStatueLevel(this.statue?.currentLevel)) {
      return 'Uncarved';
    }

    return STATUE_TIER_CONFIG[this.statue.currentLevel].displayName;
  }

  get progressToNextLabel(): string {
    if (!this.statue) {
      return '--';
    }

    const safeProgress = Number(this.statue.progressToNext ?? 0);
    return `${Math.min(100, Math.max(0, safeProgress)).toFixed(0)}%`;
  }

  private async loadStatue(statueId: string): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    if (!statueId) {
      this.statue = null;
      this.errorMessage = 'No statue id was provided.';
      this.isLoading = false;
      return;
    }

    try {
      const [statueDefinitions, userBadges] = await Promise.all([
        this.greekStatuesService.getGreekStatues(),
        this.loadCurrentUserBadges(),
      ]);

      const baseDefinition = statueDefinitions.find((candidate) => candidate.id === statueId);
      if (!baseDefinition) {
        this.statue = null;
        this.errorMessage = 'Statue not found.';
        return;
      }

      const hydratedFromBadges = this.hydrateFromBadge(baseDefinition, userBadges?.[statueId]);
      const navigationStatue = this.readNavigationStatue(statueId);

      this.statue = navigationStatue
        ? { ...hydratedFromBadges, ...navigationStatue }
        : hydratedFromBadges;
    } catch (error) {
      console.error('[StatueDetailPage] Failed to load statue details:', error);
      this.errorMessage = 'Unable to load this statue right now.';
      this.statue = null;
    } finally {
      this.isLoading = false;
    }
  }

  private async loadCurrentUserBadges(): Promise<UserBadgeStatsMap | null> {
    const userId = this.auth.currentUser?.uid;
    if (!userId) {
      return null;
    }

    return this.userBadgesService.getUserBadges(userId);
  }

  private hydrateFromBadge(
    statue: GreekStatueDefinition,
    badge: UserBadgeStatDoc | undefined
  ): GreekStatue {
    return {
      ...statue,
      metricValue: badge?.metricValue ?? badge?.currentValue ?? 0,
      currentValue: badge?.currentValue ?? badge?.metricValue ?? 0,
      percentile: badge?.percentile,
      currentLevel: normalizeStatueLevel(badge?.currentLevel) ?? 'None',
      nextTierValue: badge?.nextTierValue,
      progressToNext: badge?.progressToNext,
    };
  }

  private readNavigationStatue(statueId: string): GreekStatue | null {
    const state = history.state as { statue?: GreekStatue };
    const candidate = state?.statue;

    if (!candidate || candidate.id !== statueId) {
      return null;
    }

    return candidate;
  }
}
