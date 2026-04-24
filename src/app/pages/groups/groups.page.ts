import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonicModule, NavController, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { addOutline, closeOutline } from 'ionicons/icons';

import { Group } from '../../models/groups.model';
import { GroupWar } from '../../models/group-war.model';
import { GroupService } from '../../services/group.service';
import { GroupWarService } from '../../services/group-war.service';
import { AccountService } from '../../services/account/account.service';
import { ChatsService } from '../../services/chats.service';
import { AppUser } from '../../models/user.model';
import {
  LeaderboardEntry,
  LeaderboardService,
  LeaderboardTrendSeries,
  Metric,
} from '../../services/leaderboard.service';
import { UserService } from '../../services/account/user.service';
import {
  DistributionPoint,
  LeaderboardChartMode,
  LeaderboardShellComponent,
} from '../../components/leaderboard-shell/leaderboard-shell.component';
import {
  buildLeaderboardDistributionChart,
  emptyLeaderboardDistributionChart,
} from '../../components/leaderboard-shell/leaderboard-distribution.util';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-groups',
  standalone: true,
  templateUrl: './groups.page.html',
  styleUrls: ['./groups.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule, LeaderboardShellComponent, HeaderComponent],
})
export class GroupsPage implements OnInit, OnDestroy {
  private static readonly SMALL_POPULATION_THRESHOLD = 10;

  private navCtrl = inject(NavController);
  private groupService = inject(GroupService);
  private groupWarService = inject(GroupWarService);
  private accountService = inject(AccountService);
  private chatsService = inject(ChatsService);
  private leaderboardService = inject(LeaderboardService);
  private userService = inject(UserService);
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
  trainingChartMode: LeaderboardChartMode = 'distribution';
  trainingAvailableChartModes: LeaderboardChartMode[] = ['distribution'];
  trainingLeaderboardLoading = false;
  trainingLeaderboardError: string | null = null;
  trainingEntries: LeaderboardEntry[] = [];
  trainingTrendSeries: LeaderboardTrendSeries[] = [];
  trainingDistributionCurvePath = '';
  trainingDistributionPoints: DistributionPoint[] = [];
  trainingDistributionMedianXPercent: number | null = null;
  trainingDistributionMedianLabel = '';
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
  private allGroupsSub?: Subscription;
  private groupWarSubs = new Map<string, { active: Subscription; pending: Subscription }>();
  private trainingLeaderboardSub?: Subscription;
  private trainingTrendSub?: Subscription;
  private trainingLeaderboardKey: string | null = null;
  private trainingLoadVersion = 0;

  activeWarsByGroupId = new Map<string, GroupWar>();
  pendingWarsByGroupId = new Map<string, GroupWar>();
  warOptInSavingGroupIds = new Set<string>();
  pendingWarActionIds = new Set<string>();

  constructor() {
    addIcons({ addOutline, closeOutline });
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

  async showGroupsInfo(): Promise<void> {
    const alert = await this.alertCtrl.create({
      mode: 'ios',
      header: 'Groups quick guide',
      subHeader: 'Use groups for friends and leaderboard challenges',
      message: [
        '• Switch between Friends and Training tabs at the top.',
        '• Tap a group card to open its leaderboard.',
        '• Group owners can manage war opt-in and challenges.',
        '• Use the search modal to find and request new groups.'
      ].join('\n'),
      buttons: ['Got it'],
      translucent: true,
    });

    await alert.present();
  }

  openWarsLeaderboard(): void {
    this.navCtrl.navigateForward('/group-wars/leaderboard', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  openGroup(group: Group): void {
    this.searchModalOpen = false;
    this.navCtrl.navigateForward(`/leaderboard/${group.groupId}`, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  openGroupWar(group: Group): void {
    this.searchModalOpen = false;
    this.navCtrl.navigateForward(`/group-wars/${group.groupId}`, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  activeWarForGroup(groupId: string): GroupWar | undefined {
    return this.activeWarsByGroupId.get(groupId);
  }

  pendingWarForGroup(groupId: string): GroupWar | undefined {
    return this.pendingWarsByGroupId.get(groupId);
  }

  hasActiveWar(groupId: string): boolean {
    return !!this.activeWarForGroup(groupId);
  }

  hasPendingProposal(groupId: string): boolean {
    return !!this.pendingWarForGroup(groupId);
  }

  isWarOptInSaving(groupId: string): boolean {
    return this.warOptInSavingGroupIds.has(groupId);
  }

  isPendingWarActionInFlight(warId: string): boolean {
    return this.pendingWarActionIds.has(warId);
  }

  warOpponentGroupIdFor(group: Group, war: GroupWar | undefined): string {
    if (!war) {
      return '';
    }
    if (war.challengerGroupId === group.groupId) {
      return war.opponentGroupId;
    }
    if (war.opponentGroupId === group.groupId) {
      return war.challengerGroupId;
    }
    return war.opponentGroupId || war.challengerGroupId || '';
  }

  warEndLabel(war: GroupWar | undefined): string {
    const warEnd = war?.endAt ?? war?.endsAt;
    if (!warEnd) {
      return 'No end time';
    }
    return new Date(warEnd.toMillis()).toLocaleString();
  }

  isPendingWarOwnerActionable(group: Group, war: GroupWar | undefined): boolean {
    if (!group || !war || !this.currentUserId) {
      return false;
    }

    if (group.ownerUserId !== this.currentUserId) {
      return false;
    }

    if (war.challengerOwnerUid === this.currentUserId) {
      return !war.groupAAccepted;
    }
    if (war.opponentOwnerUid === this.currentUserId) {
      return !war.groupBAccepted;
    }

    return false;
  }

  async onWarOptInToggle(group: Group, enabled: boolean): Promise<void> {
    if (!this.isOwnedByCurrentUser(group) || this.isWarOptInSaving(group.groupId)) {
      return;
    }

    const groupId = group.groupId;
    this.warOptInSavingGroupIds.add(groupId);
    const previousValue = group.warOptIn;
    group.warOptIn = enabled;
    try {
      await this.groupService.setWarOptIn(groupId, enabled);
    } catch (error) {
      console.error('[GroupsPage] Failed to update war opt-in', error);
      group.warOptIn = previousValue;
      const toast = await this.toastCtrl.create({
        message: 'Could not update war opt-in.',
        duration: 1700,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      this.warOptInSavingGroupIds.delete(groupId);
    }
  }

  async acceptPendingProposal(group: Group, war: GroupWar | undefined): Promise<void> {
    if (!war || !this.currentUserId || !this.isPendingWarOwnerActionable(group, war)) {
      return;
    }

    const warId = war.warId;
    if (!warId || this.pendingWarActionIds.has(warId)) {
      return;
    }

    this.pendingWarActionIds.add(warId);
    try {
      await this.groupWarService.acceptProposedWar(warId, this.currentUserId);
      const toast = await this.toastCtrl.create({
        message: 'War proposal accepted.',
        duration: 1600,
        position: 'bottom',
      });
      await toast.present();
    } catch (error) {
      console.error('[GroupsPage] Failed to accept proposed war', error);
      const toast = await this.toastCtrl.create({
        message: 'Could not accept war proposal.',
        duration: 1800,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      this.pendingWarActionIds.delete(warId);
    }
  }

  async declinePendingProposal(group: Group, war: GroupWar | undefined): Promise<void> {
    if (!war || !this.currentUserId || !this.isPendingWarOwnerActionable(group, war)) {
      return;
    }

    const warId = war.warId;
    if (!warId || this.pendingWarActionIds.has(warId)) {
      return;
    }

    this.pendingWarActionIds.add(warId);
    try {
      await this.groupWarService.declineProposedWar(warId, this.currentUserId);
      const toast = await this.toastCtrl.create({
        message: 'War proposal declined.',
        duration: 1600,
        position: 'bottom',
      });
      await toast.present();
    } catch (error) {
      console.error('[GroupsPage] Failed to decline proposed war', error);
      const toast = await this.toastCtrl.create({
        message: 'Could not decline war proposal.',
        duration: 1800,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      this.pendingWarActionIds.delete(warId);
    }
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
    this.startAllGroupsSubscription();
  }

  closeGroupSearch(): void {
    this.searchModalOpen = false;
    this.stopAllGroupsSubscription();
  }

  private async sendJoinRequest(group: Group, requesterUid: string, ownerUid: string): Promise<void> {
    try {
      const requester = await this.userService.getUserSummaryDirectly(requesterUid);
      const requesterName = this.resolveRequesterName(requester ?? undefined);
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
    this.clearGroupWarSubscriptions();
    this.loading = true;
    this.errorMessage = null;

    this.groupsSub = this.groupService.getUserGroups(uid).subscribe({
      next: ({ user, groups }) => {
        this.userGroupIds = new Set(groups.map((group) => group.groupId));
        this.friendGroups = groups.filter((group) => !group.isPTGroup);
        this.syncGroupWarSubscriptions(this.friendGroups);
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
        this.clearGroupWarSubscriptions();
        this.errorMessage = 'Could not load your groups.';
        this.loading = false;
      },
    });
  }

  private syncGroupWarSubscriptions(groups: Group[]): void {
    const nextGroupIds = new Set(groups.map((group) => group.groupId));

    this.groupWarSubs.forEach((subs, groupId) => {
      if (nextGroupIds.has(groupId)) {
        return;
      }

      subs.active.unsubscribe();
      subs.pending.unsubscribe();
      this.groupWarSubs.delete(groupId);
      this.activeWarsByGroupId.delete(groupId);
      this.pendingWarsByGroupId.delete(groupId);
    });

    groups.forEach((group) => {
      if (this.groupWarSubs.has(group.groupId)) {
        return;
      }

      const activeSub = this.groupWarService.watchActiveWarForGroup(group.groupId).subscribe({
        next: (war) => {
          if (war) {
            this.activeWarsByGroupId.set(group.groupId, war);
            return;
          }
          this.activeWarsByGroupId.delete(group.groupId);
        },
        error: (error) => {
          console.warn('[GroupsPage] Failed to watch active war for group', {
            groupId: group.groupId,
            error,
          });
          this.activeWarsByGroupId.delete(group.groupId);
        },
      });

      const pendingSub = this.groupWarService.watchPendingWarProposals(group.groupId, 1).subscribe({
        next: (wars) => {
          const pending = wars[0];
          if (pending) {
            this.pendingWarsByGroupId.set(group.groupId, pending);
            return;
          }
          this.pendingWarsByGroupId.delete(group.groupId);
        },
        error: (error) => {
          console.warn('[GroupsPage] Failed to watch pending war proposal for group', {
            groupId: group.groupId,
            error,
          });
          this.pendingWarsByGroupId.delete(group.groupId);
        },
      });

      this.groupWarSubs.set(group.groupId, {
        active: activeSub,
        pending: pendingSub,
      });
    });
  }

  private clearGroupWarSubscriptions(): void {
    this.groupWarSubs.forEach((subs) => {
      subs.active.unsubscribe();
      subs.pending.unsubscribe();
    });
    this.groupWarSubs.clear();
    this.activeWarsByGroupId.clear();
    this.pendingWarsByGroupId.clear();
  }

  private async loadTrainingGroup(user: AppUser | undefined): Promise<void> {
    const loadVersion = ++this.trainingLoadVersion;
    this.trainingLoading = true;

    try {
      let trainingTitle = 'PT Trainees';
      let trainingGroup: Group | null = null;
      const trainerUid = (this.currentUserId || '').trim();
      const isCurrentUserTrainer = !!trainerUid && (
        user?.isPT === true || await this.groupService.hasTrainerProfile(trainerUid)
      );

      if (isCurrentUserTrainer) {
        if (!trainerUid) {
          if (loadVersion === this.trainingLoadVersion) {
            this.applyTrainingGroup(null, trainingTitle);
          }
          return;
        }

        const trainerName = `${(user?.firstName || '').trim()} ${(user?.lastName || '').trim()}`.trim();
        trainingTitle = trainerName ? `${trainerName}'s Trainees` : 'PT Trainees';

        trainingGroup = await this.groupService.ensureTrainerPtGroup(trainerUid) ?? null;
        if (loadVersion === this.trainingLoadVersion) {
          this.applyTrainingGroup(trainingGroup, trainingTitle);
        }
        return;
      }

      const trainerId = (user?.trainerId || '').trim();
      if (!trainerId) {
        if (loadVersion === this.trainingLoadVersion) {
          this.applyTrainingGroup(null, trainingTitle);
        }
        return;
      }

      const trainer = await this.userService.getUserSummaryDirectly(trainerId);
      if (!trainer) {
        if (loadVersion === this.trainingLoadVersion) {
          this.applyTrainingGroup(null, trainingTitle);
        }
        return;
      }

      const trainerName = `${(trainer.firstName || '').trim()} ${(trainer.lastName || '').trim()}`.trim();
      trainingTitle = trainerName ? `${trainerName}'s Trainees` : 'PT Trainees';

      trainingGroup = await this.groupService.getTrainerPtGroupByTrainerUid(trainerId) ?? null;
      if (loadVersion === this.trainingLoadVersion) {
        this.applyTrainingGroup(trainingGroup, trainingTitle);
      }
    } catch (err) {
      if (loadVersion !== this.trainingLoadVersion) {
        return;
      }
      console.warn('[GroupsPage] Failed to resolve training group', err);
      this.clearTrainingGroupState();
    } finally {
      if (loadVersion !== this.trainingLoadVersion) {
        return;
      }

      this.trainingLoading = false;
      if (this.selectedTab === 'training' && !this.trainingEnabled) {
        this.selectedTab = 'friends';
      }
    }
  }

  private applyTrainingGroup(group: Group | null, title: string): void {
    const previousGroupId = this.trainingGroup?.groupId ?? null;
    const nextGroupId = group?.groupId ?? null;
    const groupChanged = previousGroupId !== nextGroupId;

    this.trainingGroup = group;
    this.trainingTitle = title;
    this.trainingEnabled = !!group;

    if (!nextGroupId) {
      this.clearTrainingLeaderboardSubscription();
      this.resetTrainingLeaderboardState();
      return;
    }

    this.userGroupIds.add(nextGroupId);

    if (groupChanged) {
      this.clearTrainingLeaderboardSubscription();
      this.resetTrainingLeaderboardState();
    }

    this.subscribeToTrainingLeaderboard(nextGroupId);
  }

  private clearTrainingGroupState(): void {
    this.trainingGroup = null;
    this.trainingTitle = 'PT Trainees';
    this.trainingEnabled = false;
    this.clearTrainingLeaderboardSubscription();
    this.resetTrainingLeaderboardState();
  }

  private resetTrainingLeaderboardState(): void {
    this.trainingEntries = [];
    this.trainingTrendSeries = [];
    this.trainingChartMode = 'distribution';
    this.trainingAvailableChartModes = ['distribution'];
    this.trainingLeaderboardError = null;
    this.trainingTrendSub?.unsubscribe();
    this.trainingTrendSub = undefined;
    this.clearTrainingDistributionChart();
    this.trainingSelectedPointBin = null;
    this.trainingSelectedPointUserIds.clear();
  }

  private subscribeToTrainingLeaderboard(groupId: string): void {
    const normalizedGroupId = String(groupId ?? '').trim();
    const nextKey = `${normalizedGroupId}:${this.trainingMetric}`;
    if (!normalizedGroupId || (this.trainingLeaderboardSub && this.trainingLeaderboardKey === nextKey)) {
      return;
    }

    this.clearTrainingLeaderboardSubscription();
    this.trainingLeaderboardKey = nextKey;
    this.trainingLeaderboardLoading = true;
    this.trainingLeaderboardError = null;
    this.trainingEntries = [];
    this.trainingTrendSeries = [];
    this.trainingTrendSub?.unsubscribe();
    this.trainingTrendSub = undefined;
    this.clearTrainingDistributionChart();
    this.trainingSelectedPointBin = null;
    this.trainingSelectedPointUserIds.clear();

    this.trainingLeaderboardSub = this.leaderboardService
      .watchGroupLeaderboard(normalizedGroupId, this.trainingMetric)
      .subscribe({
        next: (entries) => {
          this.trainingEntries = entries;
          this.trainingLeaderboardError = null;
          this.trainingLeaderboardLoading = false;
          this.syncTrainingChartOptionsByPopulation();
          this.syncTrainingChartForCurrentMode();
        },
        error: (err) => {
          console.warn('[GroupsPage] Failed to load training leaderboard', err);
          this.trainingLeaderboardError = 'Could not load training leaderboard.';
          this.trainingEntries = [];
          this.trainingTrendSeries = [];
          this.trainingTrendSub?.unsubscribe();
          this.trainingTrendSub = undefined;
          this.clearTrainingDistributionChart();
          this.trainingLeaderboardLoading = false;
        },
      });
  }

  private clearTrainingLeaderboardSubscription(): void {
    this.trainingLeaderboardSub?.unsubscribe();
    this.trainingLeaderboardSub = undefined;
    this.trainingLeaderboardKey = null;
  }

  onTrainingMetricChange(metric: Metric): void {
    this.trainingMetric = metric;
    if (this.trainingGroup?.groupId) {
      this.subscribeToTrainingLeaderboard(this.trainingGroup.groupId);
    }
  }

  onTrainingChartModeChange(mode: LeaderboardChartMode): void {
    if (!this.trainingAvailableChartModes.includes(mode) || this.trainingChartMode === mode) {
      return;
    }

    this.trainingChartMode = mode;
    this.syncTrainingChartForCurrentMode();
  }

  private startAllGroupsSubscription(): void {
    if (this.allGroupsSub) {
      return;
    }

    this.allGroupsLoading = true;
    this.allGroupsError = null;
    this.allGroupsSub = this.groupService.watchAllGroups().subscribe({
      next: (groups) => {
        this.allGroups = groups;
        this.allGroupsLoading = false;
        this.allGroupsError = null;
      },
      error: (err) => {
        console.error('[GroupsPage] Failed to load all groups:', err);
        this.allGroupsError = 'Could not load groups for search.';
        this.allGroups = [];
        this.allGroupsLoading = false;
      },
    });
  }

  private stopAllGroupsSubscription(): void {
    this.allGroupsSub?.unsubscribe();
    this.allGroupsSub = undefined;
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
    const chart = buildLeaderboardDistributionChart(
      this.trainingEntries,
      (entry) => this.trainingScoreFor(entry)
    );
    this.trainingDistributionCurvePath = chart.curvePath;
    this.trainingDistributionPoints = chart.points;
    this.trainingDistributionMedianXPercent = chart.medianXPercent;
    this.trainingDistributionMedianLabel = chart.medianLabel;
  }

  private syncTrainingChartOptionsByPopulation(): void {
    if (this.trainingEntries.length <= GroupsPage.SMALL_POPULATION_THRESHOLD) {
      this.trainingAvailableChartModes = ['trend'];
      this.trainingChartMode = 'trend';
      return;
    }

    this.trainingAvailableChartModes = ['distribution', 'trend'];
    this.trainingChartMode = 'distribution';
  }

  private syncTrainingChartForCurrentMode(): void {
    if (this.trainingChartMode === 'trend') {
      this.trainingSelectedPointBin = null;
      this.trainingSelectedPointUserIds.clear();
      this.clearTrainingDistributionChart();
      this.subscribeToTrainingTrendSeries();
      return;
    }

    this.trainingTrendSub?.unsubscribe();
    this.trainingTrendSub = undefined;
    this.trainingTrendSeries = [];
    this.buildTrainingDistributionChart();
  }

  private subscribeToTrainingTrendSeries(): void {
    this.trainingTrendSub?.unsubscribe();
    this.trainingTrendSub = undefined;

    if (this.trainingEntries.length === 0) {
      this.trainingTrendSeries = [];
      return;
    }

    this.trainingTrendSub = this.leaderboardService
      .watchAddedScoreTrend(this.trainingEntries, this.trainingMetric)
      .subscribe({
        next: (series) => {
          this.trainingTrendSeries = series;
        },
        error: (error) => {
          console.warn('[GroupsPage] Failed to load training trend data', error);
          this.trainingTrendSeries = [];
        },
      });
  }

  private clearTrainingDistributionChart(): void {
    const chart = emptyLeaderboardDistributionChart();
    this.trainingDistributionCurvePath = chart.curvePath;
    this.trainingDistributionPoints = chart.points;
    this.trainingDistributionMedianXPercent = chart.medianXPercent;
    this.trainingDistributionMedianLabel = chart.medianLabel;
  }

  ngOnDestroy(): void {
    this.groupsSub?.unsubscribe();
    this.authSub?.unsubscribe();
    this.stopAllGroupsSubscription();
    this.clearGroupWarSubscriptions();
    this.clearTrainingLeaderboardSubscription();
    this.trainingTrendSub?.unsubscribe();
  }
}
