import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  CUSTOM_ELEMENTS_SCHEMA,
  effect,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  ModalController,
  LoadingController,
  ToastController,
  AlertController,
} from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular';

import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Storage, ref, deleteObject } from '@angular/fire/storage';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { UserService } from '../../services/account/user.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';
import { FileUploadService } from '../../services/file-upload.service';
import { ImagePickerService } from '../../services/image-picker.service';
import { UserBadgesService } from '../../services/user-badges.service';
import { UserStatsService } from '../../services/user-stats.service';
import { GreekStatuesService } from '../../services/greek-statues.service';
import type { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import type { clientProfile } from '../../Interfaces/Profiles/client';
import { addIcons } from 'ionicons';
import {
  settingsOutline,
  createOutline,
  fitness,
  statsChart,
  trophy,
  star,
  peopleOutline,
  searchOutline,
  trophyOutline,
  mapOutline,
  analyticsOutline,
  people,
  school,
  cash,
  checkmarkCircle,
} from 'ionicons/icons';
import {
  GreekStatue,
  isCarvedStatueLevel,
} from '../../models/greek-statue.model';
import { UserBadgeStatsMap } from '../../models/user-badges.model';
import { UserStats } from '../../models/user-stats.model';
import { StatueSelectorComponent } from '../../components/statue-selector/statue-selector.component';
import { GreekStatueComponent } from '../../components/greek-statue/greek-statue.component';
import { HeaderComponent } from '../../components/header/header.component';
import { AccountService } from '../../services/account/account.service';

@Component({
  selector: 'app-profile-user',
  standalone: true,
  templateUrl: './profile-user.page.html',
  styleUrls: ['./profile-user.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    GreekStatueComponent,
    HeaderComponent,
  ],
})
export class ProfileUserPage implements OnInit, OnDestroy {
  @ViewChild('statueSwiper') private statueSwiperRef?: ElementRef<HTMLElement>;

  private router = inject(Router);
  private navCtrl = inject(NavController);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private storage = inject(Storage);
  private userService = inject(UserService);
  private profileRepository = inject(ProfileRepositoryService);
  private fileUploadService = inject(FileUploadService);
  private imagePickerService = inject(ImagePickerService);
  private accountService = inject(AccountService);
  private userBadgesService = inject(UserBadgesService);
  private userStatsService = inject(UserStatsService);
  private greekStatuesService = inject(GreekStatuesService);

  isLoading = true;
  currentUser: (trainerProfile | clientProfile) | null = null;
  currentUserStats: UserStats | null = null;
  readonly defaultProfileImage = 'assets/user_icons/profilePhoto.svg';

  profilepicUrl: string = this.defaultProfileImage;
  private usersDocFirstName = '';
  private usersDocLastName = '';
  private usersDocUsername = '';
  private hasEnteredView = false;
  private roleLoadInFlight = false;
  private pendingIdentityUid: string | null = null;
  private loadedIdentityUid: string | null = null;
  private pendingRoleLoadKey: string | null = null;
  private loadedRoleLoadKey: string | null = null;
  private usersDocUnsubscribe: (() => void) | null = null;
  private usersDocListenerUid: string | null = null;
  private latestUserBadges: UserBadgeStatsMap | null = null;
  private trainerStatsFallbackPromise: Promise<void> | null = null;
  private trainerStatsFallbackUid: string | null = null;
  private trainerStatsFallbackLoadedUid: string | null = null;
  private pendingSwiperSyncFrame: number | null = null;

  // Greek Statue properties
  allStatues: GreekStatue[] = [];
  displayStatues: GreekStatue[] = [];
  displayStatueIds: string[] = [];
  currentSlideIndex: number = 0;

  // Trainer Stats properties
  trainerStats = {
    totalClients: 0,
    totalSessions: 0,
    longestStandingClient: { name: '', durationDays: 0 },
    topPerformingClient: { name: '', improvement: '' },
    totalRevenue: 0
  };

  get carvedStatuesCount(): number {
    return this.allStatues.filter((statue) => isCarvedStatueLevel(statue.currentLevel)).length;
  }

  get currentLevel(): number {
    const rawLevel = Number(this.currentUserStats?.level ?? 0);
    if (!Number.isFinite(rawLevel) || rawLevel < 0) {
      return 0;
    }
    return Math.floor(rawLevel);
  }

  get currentLevelProgress(): number {
    const rawPercentage = Number(this.currentUserStats?.percentage_of_level ?? 0);
    if (!Number.isFinite(rawPercentage) || rawPercentage <= 0) {
      return 0;
    }

    return Math.min(1, Math.max(0, rawPercentage * 0.01));
  }

  get isTrainerVerified(): boolean {
    return this.currentUserStats?.trainerVerified === true;
  }

  constructor() {
    addIcons({
      settingsOutline,
      createOutline,
      fitness,
      statsChart,
      trophy,
      star,
      peopleOutline,
      searchOutline,
      trophyOutline,
      mapOutline,
      analyticsOutline,
      people,
      school,
      cash,
      checkmarkCircle,
    });

    // Use the UserService's signal to get user data
    effect(() => {
      const userInfo = this.userService.getUserInfo()();
      const uid = this.auth.currentUser?.uid;
      
      if (userInfo) {
        this.currentUser = userInfo;
        
        const pic = this.normalizeProfileImage(
          (this.currentUser as any)?.profilepic || ''
        );
        this.profilepicUrl = pic ?? this.defaultProfileImage;
        
        this.isLoading = false;
        
        // Stage profile loads; run after route transition enters.
        if (uid) {
          if (this.loadedIdentityUid !== uid) {
            this.pendingIdentityUid = uid;
          }
          const roleLoadKey = `${uid}:${this.currentUser.accountType}`;
          if (this.loadedRoleLoadKey !== roleLoadKey) {
            this.pendingRoleLoadKey = roleLoadKey;
          }
          if (this.hasEnteredView) {
            void this.runDeferredLoads();
          }
        }
      } else {
        this.currentUser = null;
        this.profilepicUrl = this.defaultProfileImage;
        this.pendingIdentityUid = null;
        this.loadedIdentityUid = null;
        this.pendingRoleLoadKey = null;
        this.loadedRoleLoadKey = null;
        this.latestUserBadges = null;
        this.currentUserStats = null;
        this.trainerStatsFallbackUid = null;
        this.trainerStatsFallbackLoadedUid = null;
        this.resetTrainerStats();
        this.allStatues = [];
        this.displayStatueIds = [];
        this.updateDisplayStatues();
        this.isLoading = false;
      }
    });

    effect(() => {
      const userInfo = this.userService.getUserInfo()();
      const userBadges = this.userBadgesService.getCurrentUserBadges()();
      const availableStatues = this.greekStatuesService.getCurrentGreekStatues()();
      const uid = this.auth.currentUser?.uid ?? null;

      if (!userInfo || !uid) {
        this.latestUserBadges = null;
        return;
      }

      this.latestUserBadges = userBadges;
      if (userInfo.accountType === 'trainer') {
        this.applyTrainerBadges(uid, userBadges, availableStatues);
        return;
      }

      this.applyClientStatuesFromBadges(userBadges, availableStatues);
    });

    effect(() => {
      this.currentUserStats = this.userStatsService.getCurrentUserStats()();
    });
  }

  ngOnInit(): void {
    // Effect is now in constructor
  }

  ionViewDidEnter(): void {
    this.hasEnteredView = true;
    const uid = this.auth.currentUser?.uid ?? null;
    if (uid) {
      this.startUsersDocRealtimeListener(uid);
      if (this.currentUser?.accountType === 'trainer') {
        void this.calculateTrainerStatsFromBookings(uid);
      }
    }
    void this.runDeferredLoads();
  }

  ionViewDidLeave(): void {
    this.hasEnteredView = false;
    this.stopUsersDocRealtimeListener();
  }

  ngOnDestroy(): void {
    this.hasEnteredView = false;
    this.roleLoadInFlight = false;
    this.stopUsersDocRealtimeListener();
    if (this.pendingSwiperSyncFrame !== null) {
      cancelAnimationFrame(this.pendingSwiperSyncFrame);
      this.pendingSwiperSyncFrame = null;
    }
  }

  private async runDeferredLoads(): Promise<void> {
    if (!this.hasEnteredView || this.roleLoadInFlight) {
      return;
    }

    this.roleLoadInFlight = true;
    try {
      const uid = this.auth.currentUser?.uid ?? null;
      if (!uid || !this.currentUser) {
        return;
      }

      if (this.pendingIdentityUid === uid && this.loadedIdentityUid !== uid) {
        await Promise.all([
          this.loadIdentityFromUsersDoc(uid),
          this.loadProfileImageFromUserDoc(uid),
        ]);
        this.loadedIdentityUid = uid;
        this.pendingIdentityUid = null;
      }

      const roleLoadKey = `${uid}:${this.currentUser.accountType}`;
      if (this.pendingRoleLoadKey === roleLoadKey && this.loadedRoleLoadKey !== roleLoadKey) {
        // userBadges are loaded once during login bootstrap and kept fresh centrally.
        this.loadedRoleLoadKey = roleLoadKey;
        this.pendingRoleLoadKey = null;
      }
    } finally {
      this.roleLoadInFlight = false;
      if (this.hasEnteredView && (this.pendingIdentityUid || this.pendingRoleLoadKey)) {
        void this.runDeferredLoads();
      }
    }
  }

  get displayName(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const last = (this.currentUser?.lastName || '').trim();
    const fallbackFirst = this.usersDocFirstName.trim();
    const fallbackLast = this.usersDocLastName.trim();
    const full = `${first || fallbackFirst} ${last || fallbackLast}`.trim();
    return full || 'User';
  }

  get displayUsername(): string {
    const fromProfile = ((this.currentUser as any)?.username || '').trim();
    const fromUsersDoc = this.usersDocUsername.trim();
    return fromProfile || fromUsersDoc || '';
  }

  onSettingsClick(): void {
    this.router.navigate(['/user-settings']);
  }

  async onProfileImageClick(): Promise<void> {
    let shouldChangeImage = false;
    const alert = await this.alertCtrl.create({
      header: 'Profile Picture',
      message: 'Would you like to change your profile picture?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Change Image',
          handler: () => {
            shouldChangeImage = true;
          },
        },
      ],
    });
    await alert.present();

    await alert.onDidDismiss();
    if (shouldChangeImage) {
      await this.changeProfileImage();
    }
  }

  goToGroups(): void {
    this.navCtrl.navigateForward('/groups', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToLogWorkout(): void {
    this.navCtrl.navigateForward('/logging-method-routes', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToWorkoutHistory(): void {
    this.navCtrl.navigateForward('/workout-history', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToFindPT(): void {
    this.navCtrl.navigateForward('/client-find-trainer', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToRegional(): void { this.router.navigateByUrl('/regional-leaderboard'); }
  goToAnalyzeWorkout(): void {
    this.navCtrl.navigateForward('/camera', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  // Statue management methods

  onSlideChange(event: any): void {
    this.currentSlideIndex = event?.detail?.[0]?.activeIndex ?? 0;
  }

  openStatueDetails(statue: GreekStatue): void {
    this.router.navigate(['/statues', statue.id], {
      state: { statue },
    });
  }

  private resetTrainerStats(): void {
    this.trainerStats = {
      totalClients: 0,
      totalSessions: 0,
      longestStandingClient: { name: '', durationDays: 0 },
      topPerformingClient: { name: '', improvement: '' },
      totalRevenue: 0
    };
  }

  private async calculateTrainerStatsFromBookings(trainerId: string): Promise<void> {
    try {
      // Get all bookings for this trainer
      const bookingsRef = collection(this.firestore, 'bookings');
      const trainerBookingsQuery = query(
        bookingsRef,
        where('trainerId', '==', trainerId)
      );
      const bookingsSnap = await getDocs(trainerBookingsQuery);
      
      const completedSessions = bookingsSnap.docs.filter(doc => 
        doc.data()['status'] === 'completed'
      );
      this.trainerStats.totalSessions = completedSessions.length;

      // Calculate total revenue
      this.trainerStats.totalRevenue = completedSessions.reduce((sum, doc) => {
        return sum + (doc.data()['price'] || 0);
      }, 0);

      // Count all clients for this trainer from trainers/{trainerId}/clients
      const trainerClientsRef = collection(this.firestore, `trainers/${trainerId}/clients`);
      const trainerClientsSnap = await getDocs(trainerClientsRef);
      this.trainerStats.totalClients = trainerClientsSnap.size;
      
      console.log('[ProfileUser] Calculated trainer stats from bookings:', this.trainerStats);
    } catch (error) {
      console.error('[ProfileUser] Error calculating trainer stats from bookings:', error);
    }
  }

  private applyClientStatuesFromBadges(
    userBadges: UserBadgeStatsMap | null,
    availableStatues: GreekStatue[]
  ): void {
    const trainerStatueIds = ['zeus-mentor', 'athena-wisdom', 'hermes-prosperity'];
    const badgeMap = userBadges ?? {};

    this.allStatues = availableStatues
      .filter((statue) => !trainerStatueIds.includes(statue.id))
      .map((statue) => this.buildStatueViewModel(statue, badgeMap[statue.id]));

    this.displayStatueIds = this.allStatues
      .filter(
        (statue) =>
          badgeMap[statue.id]?.isDisplayed && isCarvedStatueLevel(statue.currentLevel)
      )
      .map((statue) => statue.id)
      .filter((id) => {
        const statue = this.allStatues.find((candidate) => candidate.id === id);
        return isCarvedStatueLevel(statue?.currentLevel);
      });
    this.updateDisplayStatues();
  }

  private applyTrainerBadges(
    userId: string,
    userBadges: UserBadgeStatsMap | null,
    availableStatues: GreekStatue[]
  ): void {
    const trainerBadges = userBadges ?? {};
    const hasStoredStats =
      trainerBadges['athena-wisdom']?.currentValue !== undefined ||
      trainerBadges['zeus-mentor']?.currentValue !== undefined ||
      trainerBadges['hermes-prosperity']?.currentValue !== undefined;

    if (hasStoredStats) {
      this.trainerStats.totalSessions = trainerBadges['athena-wisdom']?.currentValue || 0;
      this.trainerStats.totalClients = trainerBadges['zeus-mentor']?.currentValue || 0;
      this.trainerStats.totalRevenue = trainerBadges['hermes-prosperity']?.currentValue || 0;
      this.trainerStatsFallbackLoadedUid = userId;
    } else if (this.trainerStatsFallbackLoadedUid !== userId) {
      void this.ensureTrainerFallbackStats(userId);
    }

    const trainerStatueIds = ['zeus-mentor', 'athena-wisdom', 'hermes-prosperity'];

    this.allStatues = availableStatues
      .filter((statue) => trainerStatueIds.includes(statue.id))
      .map((statue) => this.buildStatueViewModel(statue, trainerBadges[statue.id]));

    this.displayStatueIds = this.allStatues
      .filter(
        (statue) =>
          trainerBadges[statue.id]?.isDisplayed && isCarvedStatueLevel(statue.currentLevel)
      )
      .map((statue) => statue.id)
      .filter((id) => {
        const statue = this.allStatues.find((candidate) => candidate.id === id);
        return isCarvedStatueLevel(statue?.currentLevel);
      });
    this.updateDisplayStatues();
  }

  private buildStatueViewModel(
    statue: GreekStatue,
    statueDoc: UserBadgeStatsMap[string] | undefined
  ): GreekStatue {
    return {
      ...statue,
      metricValue: statueDoc?.metricValue ?? statueDoc?.currentValue ?? 0,
      currentValue: statueDoc?.currentValue ?? statueDoc?.metricValue ?? 0,
      percentile: statueDoc?.percentile,
      currentLevel: (statueDoc?.currentLevel as GreekStatue['currentLevel'] | undefined) ?? 'None',
      nextTierValue: statueDoc?.nextTierValue,
      progressToNext: statueDoc?.progressToNext,
    };
  }

  private async ensureTrainerFallbackStats(userId: string): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return;
    }

    if (
      this.trainerStatsFallbackPromise &&
      this.trainerStatsFallbackUid === normalizedUserId
    ) {
      return this.trainerStatsFallbackPromise;
    }

    this.trainerStatsFallbackUid = normalizedUserId;
    this.trainerStatsFallbackPromise = this.calculateTrainerStatsFromBookings(normalizedUserId)
      .finally(() => {
        this.trainerStatsFallbackPromise = null;
      });

    await this.trainerStatsFallbackPromise;
    this.trainerStatsFallbackLoadedUid = normalizedUserId;
    if (this.currentUser?.accountType === 'trainer') {
      this.applyTrainerBadges(
        normalizedUserId,
        this.latestUserBadges,
        this.greekStatuesService.getCurrentGreekStatues()()
      );
    }
  }

  updateDisplayStatues() {
    this.displayStatues = this.displayStatueIds
      .map(id => this.allStatues.find(s => s.id === id))
      .filter(statue => statue !== undefined) as GreekStatue[];

    if (this.displayStatues.length === 0) {
      this.currentSlideIndex = 0;
      return;
    }

    this.currentSlideIndex = Math.min(
      this.currentSlideIndex,
      Math.max(this.displayStatues.length - 1, 0)
    );
    this.scheduleStatueSwiperSync();
  }

  private scheduleStatueSwiperSync(): void {
    if (this.pendingSwiperSyncFrame !== null) {
      cancelAnimationFrame(this.pendingSwiperSyncFrame);
    }

    if (this.displayStatues.length === 0) {
      this.pendingSwiperSyncFrame = null;
      return;
    }

    this.pendingSwiperSyncFrame = requestAnimationFrame(() => {
      this.pendingSwiperSyncFrame = null;
      const swiperElement = this.statueSwiperRef?.nativeElement as
        | (HTMLElement & {
            swiper?: {
              update?: () => void;
              slideTo?: (index: number, speed?: number) => void;
            };
            initialize?: () => void;
            slidesPerView?: number;
            centeredSlides?: boolean;
            spaceBetween?: number;
            breakpoints?: Record<number, { slidesPerView: number; spaceBetween?: number }>;
            pagination?: boolean;
            allowTouchMove?: boolean;
          })
        | undefined;

      if (!swiperElement || this.displayStatues.length === 0) {
        return;
      }

      if (!swiperElement.swiper) {
        swiperElement.slidesPerView = 1.18;
        swiperElement.centeredSlides = true;
        swiperElement.spaceBetween = 14;
        swiperElement.breakpoints = {
          768: {
            slidesPerView: 1.45,
            spaceBetween: 18,
          },
        };
        swiperElement.pagination = false;
        swiperElement.allowTouchMove = this.displayStatues.length > 1;
        swiperElement.initialize?.();
      } else {
        swiperElement.allowTouchMove = this.displayStatues.length > 1;
      }

      swiperElement.swiper?.update?.();
      swiperElement.swiper?.slideTo?.(this.currentSlideIndex, 0);
    });
  }

  async openBadgeSelector() {
    const carvedStatues = this.allStatues.filter((statue) =>
      isCarvedStatueLevel(statue.currentLevel)
    );
    const carvedStatueIdSet = new Set(carvedStatues.map((statue) => statue.id));
    const selectedCarvedIds = this.displayStatueIds.filter((id) =>
      carvedStatueIdSet.has(id)
    );

    const modal = await this.modalCtrl.create({
      component: StatueSelectorComponent,
      componentProps: {
        carvedStatues,
        selectedStatueIds: selectedCarvedIds
      }
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'confirm') {
      const nextDisplayIds = Array.isArray(data)
        ? data
            .map((id) => String(id ?? '').trim())
            .filter((id): id is string => id.length > 0 && carvedStatueIdSet.has(id))
        : [];

      this.displayStatueIds = Array.from(new Set(nextDisplayIds));
      this.updateDisplayStatues();
      await this.saveDisplayStatues();
    }
  }

  async saveDisplayStatues() {
    const uid = this.currentUser?.id || this.auth.currentUser?.uid;
    if (!uid) {
      this.showToast('Not signed in');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Saving display statues...'
    });
    await loading.present();

    try {
      await this.userBadgesService.saveDisplayStatues(uid, this.displayStatueIds);
      this.showToast('Display statues updated successfully');
    } catch (error) {
      console.error('Error updating display statues:', error);
      this.showToast('Failed to update display statues');
    } finally {
      loading.dismiss();
    }
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'bottom'
    });
    await toast.present();
  }

  private normalizeProfileImage(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async loadProfileImageFromUserDoc(uid: string): Promise<void> {
    try {
      const userSummary = await this.profileRepository.getUserSummary(uid);
      if (!userSummary) {
        this.profilepicUrl = this.defaultProfileImage;
        return;
      }

      const userDocPic = this.normalizeProfileImage(
        userSummary.profilepic || ''
      );
      this.profilepicUrl = userDocPic ?? this.defaultProfileImage;
    } catch (error) {
      console.error('[ProfileUserPage] Error loading users doc profile image:', error);
      this.profilepicUrl = this.defaultProfileImage;
    }
  }

  private async loadIdentityFromUsersDoc(uid: string): Promise<void> {
    try {
      const userSummary = await this.profileRepository.getUserSummary(uid);
      if (!userSummary) {
        return;
      }

      this.usersDocFirstName = typeof userSummary.firstName === 'string' ? userSummary.firstName : '';
      this.usersDocLastName = typeof userSummary.lastName === 'string' ? userSummary.lastName : '';
      this.usersDocUsername = typeof userSummary.username === 'string' ? userSummary.username : '';
    } catch (error) {
      console.error('[ProfileUserPage] Error loading users doc identity:', error);
    }
  }

  private startUsersDocRealtimeListener(uid: string): void {
    if (!uid) return;
    if (this.usersDocUnsubscribe && this.usersDocListenerUid === uid) {
      return;
    }

    this.stopUsersDocRealtimeListener();
    this.usersDocListenerUid = uid;

    this.usersDocUnsubscribe = this.profileRepository.observeUserSummary(
      uid,
      (userSummary) => {
        if (!userSummary) {
          return;
        }

        const nextFirstName = typeof userSummary.firstName === 'string' ? userSummary.firstName : '';
        const nextLastName = typeof userSummary.lastName === 'string' ? userSummary.lastName : '';
        const nextUsername = typeof userSummary.username === 'string' ? userSummary.username : '';
        const nextProfilePic = this.normalizeProfileImage(userSummary.profilepic || '');

        this.usersDocFirstName = nextFirstName;
        this.usersDocLastName = nextLastName;
        this.usersDocUsername = nextUsername;
        this.profilepicUrl = nextProfilePic ?? this.defaultProfileImage;

        if (this.currentUser) {
          (this.currentUser as any).firstName = nextFirstName || (this.currentUser as any).firstName;
          (this.currentUser as any).lastName = nextLastName || (this.currentUser as any).lastName;
          (this.currentUser as any).username = nextUsername || (this.currentUser as any).username;
          (this.currentUser as any).profilepic = nextProfilePic ?? (this.currentUser as any).profilepic;
        }
      }
    );
  }

  private stopUsersDocRealtimeListener(): void {
    this.usersDocUnsubscribe?.();
    this.usersDocUnsubscribe = null;
    this.usersDocListenerUid = null;
  }

  private async changeProfileImage(): Promise<void> {
    const accountUid = this.accountService.getCredentials()().uid || null;
    const authUid = this.auth.currentUser?.uid ?? null;
    const uid = accountUid || authUid;

    if (!uid) {
      await this.showToast('You must be signed in to change your profile picture.');
      return;
    }

    const file = await this.imagePickerService.pickImageFile();
    if (!file) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Updating profile picture...',
    });
    await loading.present();

    try {
      const oldUrl = this.normalizeProfileImage(this.profilepicUrl);
      const sanitizedName = file.name.replace(/\s+/g, '_');
      const storagePath = `profile-pictures/${uid}/${Date.now()}_${sanitizedName}`;
      const downloadUrl = await this.fileUploadService.uploadFile(storagePath, file);

      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          profilepic: downloadUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      this.profileRepository.applyUserSummaryPatch(uid, { profilepic: downloadUrl });
      this.userService.syncCurrentUserSummaryPatch(uid, { profilepic: downloadUrl });

      if (oldUrl && oldUrl !== this.defaultProfileImage && oldUrl !== downloadUrl) {
        await this.deleteExistingProfileImage(oldUrl);
      }

      this.profilepicUrl = downloadUrl;
      if (this.currentUser) {
        (this.currentUser as any).profilepic = downloadUrl;
      }
      await this.showToast('Profile picture updated.');
    } catch (error) {
      console.error('[ProfileUserPage] Failed to update profile picture:', error);
      const message = error instanceof Error ? error.message : 'Please try again.';
      await this.showToast(`Failed to update profile picture: ${message}`);
    } finally {
      await loading.dismiss();
    }
  }

  private async deleteExistingProfileImage(url: string): Promise<void> {
    const storagePath = this.extractStoragePathFromDownloadUrl(url);
    if (!storagePath) {
      return;
    }

    try {
      const imageRef = ref(this.storage, storagePath);
      await deleteObject(imageRef);
    } catch (error) {
      // Non-blocking: continue with new upload even if old file delete fails.
      console.warn('[ProfileUserPage] Failed to delete old profile image:', error);
    }
  }

  private extractStoragePathFromDownloadUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const marker = '/o/';
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) {
        return null;
      }

      const encodedPath = parsed.pathname.substring(idx + marker.length);
      return decodeURIComponent(encodedPath);
    } catch {
      return null;
    }
  }
}
