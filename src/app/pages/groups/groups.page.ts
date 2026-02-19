import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonicModule, NavController, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { arrowBackOutline, addOutline, closeOutline } from 'ionicons/icons';

import { Group } from '../../models/groups.model';
import { GroupService } from '../../services/group.service';
import { AccountService } from '../../services/account/account.service';
import { ChatsService } from '../../services/chats.service';
import { AppUser } from '../../models/user.model';
import { LeaderboardEntry, LeaderboardService, Metric } from '../../services/leaderboard.service';
import {
  DistributionPoint,
  LeaderboardShellComponent,
} from '../../components/leaderboard-shell/leaderboard-shell.component';

@Component({
  selector: 'app-groups',
  standalone: true,
  templateUrl: './groups.page.html',
  styleUrls: ['./groups.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule, LeaderboardShellComponent],
})
export class GroupsPage implements OnInit, OnDestroy {
  private navCtrl = inject(NavController);
  private groupService = inject(GroupService);
  private accountService = inject(AccountService);
  private chatsService = inject(ChatsService);
  private leaderboardService = inject(LeaderboardService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  selectedTab: 'training' | 'friends' = 'friends';
  loading = true;
  errorMessage: string | null = null;
  friendGroups: Group[] = [];
  trainingGroup: Group | null = null;
  trainingTitle = 'PT Trainees';
  trainingEnabled = false;
  trainingLoading = false;
  trainingMetric: Metric = 'total';
  trainingLeaderboardLoading = false;
  trainingLeaderboardError: string | null = null;
  trainingEntries: LeaderboardEntry[] = [];
  trainingDistributionCurvePath = '';
  trainingDistributionPoints: DistributionPoint[] = [];
  trainingSelectedPointBin: number | null = null;
  trainingSelectedPointUserIds = new Set<string>();

  searchModalOpen = false;
  searchQuery = '';
  allGroups: Group[] = [];
  allGroupsLoading = false;
  allGroupsError: string | null = null;
  userGroupIds = new Set<string>();
  currentUserId: string | null = null;

  private groupsSub?: Subscription;
  private authSub?: Subscription;

  constructor() {
    addIcons({ arrowBackOutline, addOutline, closeOutline });
  }

  ngOnInit(): void {
    const uid = this.accountService.getCredentials()().uid;
    if (uid) {
      this.currentUserId = uid;
      this.subscribeToGroups(uid);
      return;
    }

    this.loading = false;
    this.authSub = this.accountService.authStateChanges$.subscribe(({ user, isAuthenticated }) => {
      if (!isAuthenticated || !user?.uid) return;
      this.currentUserId = user.uid;
      this.subscribeToGroups(user.uid);
    });
  }

  selectTab(tab: 'training' | 'friends'): void {
    if (tab === 'training' && !this.trainingEnabled) return;
    this.selectedTab = tab;
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
  }

  openGroup(group: Group): void {
    this.searchModalOpen = false;
    this.navCtrl.navigateForward(`/leaderboard/${group.groupId}`, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  async onSearchGroupPressed(group: Group): Promise<void> {
    const currentUid = this.currentUserId;
    const ownerUid = (group.ownerUserId || '').trim();

    if (!currentUid || !ownerUid || currentUid === ownerUid) {
      return;
    }

    const alert = await this.alertCtrl.create({
      header: `Ask to join ${group.name}?`,
      buttons: [
        {
          text: 'No',
          role: 'cancel',
        },
        {
          text: 'Yes',
          handler: () => {
            void this.sendJoinRequest(group, currentUid, ownerUid);
          },
        },
      ],
    });

    await alert.present();
  }

  get filteredAllGroups(): Group[] {
    const q = this.searchQuery.trim().toLowerCase();
    const base = this.allGroups.filter(
      (group) => !group.isPTGroup && !this.userGroupIds.has(group.groupId)
    );

    if (!q) return base.slice(0, 30);
    return base.filter((group) => (group.name || '').toLowerCase().includes(q)).slice(0, 30);
  }

  async openGroupSearch(): Promise<void> {
    this.searchModalOpen = true;
    this.searchQuery = '';

    if (this.allGroups.length > 0 || this.allGroupsLoading) {
      return;
    }

    this.allGroupsLoading = true;
    this.allGroupsError = null;
    try {
      this.allGroups = await this.groupService.getAllGroupsOnce();
    } catch (err) {
      console.error('[GroupsPage] Failed to load all groups:', err);
      this.allGroupsError = 'Could not load groups for search.';
      this.allGroups = [];
    } finally {
      this.allGroupsLoading = false;
    }
  }

  closeGroupSearch(): void {
    this.searchModalOpen = false;
  }

  private async sendJoinRequest(group: Group, requesterUid: string, ownerUid: string): Promise<void> {
    try {
      const requester = await firstValueFrom(this.groupService.getUser(requesterUid));
      const requesterName = this.resolveRequesterName(requester);
      const chatId = await this.chatsService.findOrCreateDirectChat(requesterUid, ownerUid);

      await this.chatsService.sendJoinRequest(
        chatId,
        requesterUid,
        requesterName,
        ownerUid,
        group.groupId,
        group.name
      );

      this.closeGroupSearch();
      const toast = await this.toastCtrl.create({
        message: `Join request sent to ${group.name}.`,
        duration: 1600,
        position: 'bottom',
      });
      await toast.present();
    } catch (error) {
      console.error('[GroupsPage] Failed to send join request:', error);
      const toast = await this.toastCtrl.create({
        message: 'Could not send join request.',
        duration: 1800,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    }
  }

  private resolveRequesterName(user: AppUser | undefined): string {
    const username = (user?.username || '').trim();
    if (username) {
      return `@${username}`;
    }

    const full = `${(user?.firstName || '').trim()} ${(user?.lastName || '').trim()}`.trim();
    if (full) {
      return full;
    }

    return 'A user';
  }

  isOwnedByCurrentUser(group: Group): boolean {
    if (!this.currentUserId) return false;
    return group.ownerUserId === this.currentUserId;
  }

  async promptCreateGroup(): Promise<void> {
    const uid = this.accountService.getCredentials()().uid;
    if (!uid) {
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Enter Group Name',
      inputs: [
        {
          name: 'groupName',
          type: 'text',
          placeholder: 'Group Name',
        },
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Create',
          handler: async (data) => {
            const groupName = typeof data?.groupName === 'string' ? data.groupName.trim() : '';
            if (!groupName) {
              return false;
            }

            try {
              const groupId = await this.groupService.createGroupForOwner(uid, groupName, false);
              this.userGroupIds.add(groupId);
              this.closeGroupSearch();

              const toast = await this.toastCtrl.create({
                message: 'Group created.',
                duration: 1500,
                position: 'bottom',
              });
              await toast.present();
            } catch (err) {
              console.error('[GroupsPage] Failed to create group:', err);
              const toast = await this.toastCtrl.create({
                message: 'Could not create group.',
                duration: 1800,
                color: 'danger',
                position: 'bottom',
              });
              await toast.present();
            }
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  private subscribeToGroups(uid: string): void {
    this.groupsSub?.unsubscribe();
    this.loading = true;
    this.errorMessage = null;

    this.groupsSub = this.groupService.getUserGroups(uid).subscribe({
      next: ({ user, groups }) => {
        this.userGroupIds = new Set(groups.map((group) => group.groupId));
        this.friendGroups = groups.filter((group) => !group.isPTGroup);
        void this.loadTrainingGroup(user);
        this.loading = false;
      },
      error: (err) => {
        console.error('[GroupsPage] Failed to load groups:', err);
        this.userGroupIds = new Set<string>();
        this.friendGroups = [];
        this.trainingGroup = null;
        this.trainingEnabled = false;
        if (this.selectedTab === 'training') {
          this.selectedTab = 'friends';
        }
        this.errorMessage = 'Could not load your groups.';
        this.loading = false;
      },
    });
  }

  private async loadTrainingGroup(user: AppUser | undefined): Promise<void> {
    this.trainingLoading = true;
    this.trainingGroup = null;
    this.trainingTitle = 'PT Trainees';
    this.trainingEnabled = false;
    this.trainingEntries = [];
    this.trainingLeaderboardError = null;
    this.trainingDistributionCurvePath = '';
    this.trainingDistributionPoints = [];
    this.trainingSelectedPointBin = null;
    this.trainingSelectedPointUserIds.clear();

    try {
      const ptUID = (user?.ptUID || '').trim();
      if (!ptUID) return;

      const trainer = await firstValueFrom(this.groupService.getUser(ptUID));
      if (!trainer) return;

      const trainerName = `${(trainer.firstName || '').trim()} ${(trainer.lastName || '').trim()}`.trim();
      this.trainingTitle = `${trainerName}'s Trainees`;

      const ownedGroupIdRaw = (trainer as any).ownedGroupIDn ?? trainer.ownedGroupID;
      const ownedGroupId = typeof ownedGroupIdRaw === 'string' ? ownedGroupIdRaw.trim() : '';
      if (!ownedGroupId) return;

      const group = await firstValueFrom(this.groupService.getGroup(ownedGroupId));
      if (!group) return;

      this.trainingGroup = group;
      this.trainingEnabled = true;
      await this.loadTrainingLeaderboard(group.groupId);
    } catch (err) {
      console.warn('[GroupsPage] Failed to resolve training group', err);
      this.trainingGroup = null;
      this.trainingTitle = 'PT Trainees';
      this.trainingEnabled = false;
      this.trainingEntries = [];
      this.trainingLeaderboardError = null;
      this.trainingDistributionCurvePath = '';
      this.trainingDistributionPoints = [];
      this.trainingSelectedPointBin = null;
      this.trainingSelectedPointUserIds.clear();
    } finally {
      this.trainingLoading = false;
      if (this.selectedTab === 'training' && !this.trainingEnabled) {
        this.selectedTab = 'friends';
      }
    }
  }

  private async loadTrainingLeaderboard(groupId: string): Promise<void> {
    this.trainingLeaderboardLoading = true;
    this.trainingLeaderboardError = null;
    this.trainingEntries = [];
    this.trainingDistributionCurvePath = '';
    this.trainingDistributionPoints = [];
    this.trainingSelectedPointBin = null;
    this.trainingSelectedPointUserIds.clear();

    try {
      this.trainingEntries = await this.leaderboardService.getGroupLeaderboard(groupId, this.trainingMetric);
      this.buildTrainingDistributionChart();
    } catch (err) {
      console.warn('[GroupsPage] Failed to load training leaderboard', err);
      this.trainingLeaderboardError = 'Could not load training leaderboard.';
      this.trainingEntries = [];
      this.trainingDistributionCurvePath = '';
      this.trainingDistributionPoints = [];
    } finally {
      this.trainingLeaderboardLoading = false;
    }
  }

  onTrainingMetricChange(metric: Metric): void {
    this.trainingMetric = metric;
    if (this.trainingGroup?.groupId) {
      void this.loadTrainingLeaderboard(this.trainingGroup.groupId);
    }
  }

  onTrainingDistributionPointClick(point: DistributionPoint): void {
    if (this.trainingSelectedPointBin === point.binIndex) {
      this.trainingSelectedPointBin = null;
      this.trainingSelectedPointUserIds.clear();
      return;
    }

    this.trainingSelectedPointBin = point.binIndex;
    this.trainingSelectedPointUserIds = new Set(point.userIds);
  }

  onTrainingMemberClick(entry: LeaderboardEntry): void {
    const point = this.trainingDistributionPoints.find((candidate) =>
      candidate.userIds.includes(entry.userId)
    );
    if (!point) {
      this.trainingSelectedPointBin = null;
      this.trainingSelectedPointUserIds.clear();
      return;
    }

    this.trainingSelectedPointBin = point.binIndex;
    this.trainingSelectedPointUserIds = new Set(point.userIds);
  }

  private trainingScoreFor(entry: LeaderboardEntry): number {
    if (this.trainingMetric === 'cardio') return entry.cardioWorkScore ?? 0;
    if (this.trainingMetric === 'strength') return entry.strengthWorkScore ?? 0;
    return entry.totalWorkScore ?? 0;
  }

  private buildTrainingDistributionChart(): void {
    this.trainingSelectedPointBin = null;
    this.trainingSelectedPointUserIds.clear();

    if (this.trainingEntries.length === 0) {
      this.trainingDistributionCurvePath = '';
      this.trainingDistributionPoints = [];
      return;
    }

    const scores = this.trainingEntries.map((entry) => this.trainingScoreFor(entry));
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const variance =
      scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;

    let stdDev = Math.sqrt(variance);
    if (!Number.isFinite(stdDev) || stdDev < 1e-6) {
      const fallback = Math.max(Math.abs(mean) * 0.1, 1);
      stdDev = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
    }

    const dataMin = Math.min(...scores);
    const dataMax = Math.max(...scores);
    const minScore = Math.min(dataMin, mean - 3 * stdDev);
    const maxScore = Math.max(dataMax, mean + 3 * stdDev);
    const scoreSpan = Math.max(maxScore - minScore, 1);

    const chartBottom = 92;
    const curveHeight = 70;
    const toXPct = (score: number): number => 4 + ((score - minScore) / scoreSpan) * 92;
    const normalPdf = (x: number): number => {
      const z = (x - mean) / stdDev;
      return Math.exp(-0.5 * z * z);
    };
    const toYPct = (score: number): number => chartBottom - normalPdf(score) * curveHeight;

    const sampleCount = 80;
    const samples: string[] = [];
    for (let i = 0; i <= sampleCount; i += 1) {
      const score = minScore + (scoreSpan * i) / sampleCount;
      const x = toXPct(score).toFixed(2);
      const y = toYPct(score).toFixed(2);
      samples.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
    }
    this.trainingDistributionCurvePath = samples.join(' ');

    if (this.trainingEntries.length === 1) {
      const entry = this.trainingEntries[0];
      const score = this.trainingScoreFor(entry);
      this.trainingDistributionPoints = [
        {
          binIndex: 0,
          xPercent: toXPct(score),
          yPercent: toYPct(score),
          count: 1,
          userIds: [entry.userId],
          rangeLabel: `${Math.round(score)}-${Math.round(score)}`,
        },
      ];
      return;
    }

    const binCount = Math.min(12, Math.max(6, Math.round(Math.sqrt(this.trainingEntries.length))));
    const binWidth = scoreSpan / binCount;
    const bins = Array.from({ length: binCount }, () => [] as LeaderboardEntry[]);

    for (const entry of this.trainingEntries) {
      const score = this.trainingScoreFor(entry);
      const normalized = (score - minScore) / scoreSpan;
      const rawIndex = Math.floor(normalized * binCount);
      const clampedIndex = Math.min(binCount - 1, Math.max(0, rawIndex));
      bins[clampedIndex].push(entry);
    }

    this.trainingDistributionPoints = bins
      .map((bucketEntries, binIndex) => {
        if (bucketEntries.length === 0) {
          return null;
        }

        const rangeStart = minScore + binWidth * binIndex;
        const rangeEnd = rangeStart + binWidth;
        const midpoint = rangeStart + binWidth / 2;
        const userIds = bucketEntries.map((entry) => entry.userId);

        return {
          binIndex,
          xPercent: toXPct(midpoint),
          yPercent: toYPct(midpoint),
          count: bucketEntries.length,
          userIds,
          rangeLabel: `${Math.round(rangeStart)}-${Math.round(rangeEnd)}`,
        } satisfies DistributionPoint;
      })
      .filter((point): point is DistributionPoint => point !== null);
  }

  ngOnDestroy(): void {
    this.groupsSub?.unsubscribe();
    this.authSub?.unsubscribe();
  }
}
