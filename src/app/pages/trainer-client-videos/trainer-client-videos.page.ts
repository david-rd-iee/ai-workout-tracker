import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonIcon, IonSpinner, NavController } from '@ionic/angular/standalone';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { AccountService } from '../../services/account/account.service';
import { VideoPlaybackCacheService } from '../../services/video-playback-cache.service';
import { addIcons } from 'ionicons';
import { analyticsOutline, chevronForwardOutline } from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';

type TrainerClientVideoItem = {
  id: string;
  workoutName: string;
  recordedAtLabel: string;
  sortEpochMs: number;
  recordingUrl: string;
  overlayUrl: string;
  canView: boolean;
};

@Component({
  selector: 'app-trainer-client-videos',
  standalone: true,
  templateUrl: './trainer-client-videos.page.html',
  styleUrls: ['./trainer-client-videos.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class TrainerClientVideosPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(Firestore);
  private readonly accountService = inject(AccountService);
  private readonly videoPlaybackCacheService = inject(VideoPlaybackCacheService);
  private readonly navCtrl = inject(NavController);

  isLoading = true;
  errorMessage = '';
  clientId = '';
  clientName = '';
  videos: TrainerClientVideoItem[] = [];
  private videosLoadToken = 0;

  constructor() {
    addIcons({
      analyticsOutline,
      chevronForwardOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.clientId = String(this.route.snapshot.paramMap.get('clientId') || '').trim();
    this.clientName = String(this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    await this.loadClientVideos();
  }

  ngOnDestroy(): void {
    this.videosLoadToken = 0;
  }

  openVideo(video: TrainerClientVideoItem): void {
    if (!this.clientId) {
      return;
    }

    this.navCtrl.navigateForward(`/trainer-workout-analyzer/${this.clientId}`, {
      animated: true,
      animationDirection: 'forward',
      replaceUrl: true,
      queryParams: {
        clientName: this.clientName,
        analysisId: video.id,
      },
    });
  }

  private async loadClientVideos(): Promise<void> {
    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId) {
      this.errorMessage = 'You must be signed in to view analyzed videos.';
      this.isLoading = false;
      return;
    }

    if (!this.clientId) {
      this.errorMessage = 'No client was selected.';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const loadToken = Date.now();
      this.videosLoadToken = loadToken;
      const analysesRef = collection(
        this.firestore,
        `trainers/${trainerId}/clients/${this.clientId}/videoAnalysis`
      );
      const snapshot = await getDocs(analysesRef);

      const allVideos = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const analysis = this.asRecord(data['analysis']);
          const video = this.asRecord(data['video']);
          const artifacts = this.asRecord(data['artifacts']);
          const overlayVideo = this.asRecord(artifacts?.['overlayVideo']);
          const analyzedAtIso = typeof analysis?.['analyzedAtIso'] === 'string'
            ? analysis['analyzedAtIso'].trim()
            : '';
          const workoutName = typeof data['workoutName'] === 'string'
            ? data['workoutName'].trim()
            : '';
          const recordingUrl = typeof video?.['downloadUrl'] === 'string'
            ? video['downloadUrl'].trim()
            : '';
          const recordedAtRaw = this.readPossibleDateString(data['recordedAt']);
          const sortDate = this.resolveMostRecentDate(analyzedAtIso, recordedAtRaw);

          return {
            id: docSnap.id,
            workoutName: workoutName || 'Workout Video',
            recordingUrl,
            overlayUrl: typeof overlayVideo?.['downloadUrl'] === 'string'
              ? overlayVideo['downloadUrl'].trim()
              : '',
            canView: Boolean(data['canView']),
            sortEpochMs: sortDate?.getTime() ?? 0,
            recordedAtLabel: this.formatDateLabel(sortDate, analyzedAtIso || recordedAtRaw),
          };
        })
        .filter((video) => !!video.recordingUrl)
        .sort((left, right) => right.sortEpochMs - left.sortEpochMs);

      const sharedVideos = allVideos.filter((video) => video.canView);
      const pendingVideos = allVideos.filter((video) => !video.canView);
      const shouldWarmPendingBeforeReveal = this.videoPlaybackCacheService.shouldPrefetchInBackground();
      this.videos = shouldWarmPendingBeforeReveal ? sharedVideos : allVideos;

      const warmCandidateUrls = allVideos
        .slice(0, 4)
        .reduce<string[]>((accumulator, video) => {
          if (video.recordingUrl) {
            accumulator.push(video.recordingUrl);
          }
          if (video.overlayUrl) {
            accumulator.push(video.overlayUrl);
          }
          return accumulator;
        }, []);
      this.videoPlaybackCacheService.prefetchUrls(warmCandidateUrls, 8);
      if (shouldWarmPendingBeforeReveal) {
        void this.revealPendingVideosOnceCached(pendingVideos, loadToken);
      }
    } catch (error) {
      console.error('[TrainerClientVideosPage] Failed to load client videos:', error);
      this.errorMessage = 'Unable to load analyzed videos right now.';
    } finally {
      this.isLoading = false;
    }
  }

  private async revealPendingVideosOnceCached(
    pendingVideos: TrainerClientVideoItem[],
    loadToken: number,
  ): Promise<void> {
    for (const video of pendingVideos) {
      if (this.videosLoadToken !== loadToken) {
        return;
      }

      const requiredUrls = [video.recordingUrl, video.overlayUrl]
        .map((url) => url.trim())
        .filter((url) => !!url);

      if (!requiredUrls.length) {
        continue;
      }

      try {
        await Promise.all(requiredUrls.map((url) => this.videoPlaybackCacheService.prefetchUrl(url)));
      } catch {
        continue;
      }

      if (this.videosLoadToken !== loadToken) {
        return;
      }

      const isFullyCached = requiredUrls.every((url) => this.videoPlaybackCacheService.isCachedUrl(url));
      if (!isFullyCached) {
        continue;
      }

      if (this.videos.some((existing) => existing.id === video.id)) {
        continue;
      }

      this.videos = [...this.videos, video].sort((left, right) => right.sortEpochMs - left.sortEpochMs);
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private resolveMostRecentDate(analyzedAtIso: string, recordedAtRaw: string): Date | null {
    const analyzedDate = this.parseDate(analyzedAtIso);
    const recordedDate = this.parseDate(recordedAtRaw);

    if (analyzedDate && recordedDate) {
      return analyzedDate.getTime() >= recordedDate.getTime() ? analyzedDate : recordedDate;
    }

    return analyzedDate || recordedDate;
  }

  private parseDate(value: string): Date | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private readPossibleDateString(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (value && typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
      const toDate = (value as { toDate?: () => Date }).toDate;
      if (typeof toDate === 'function') {
        const date = toDate.call(value);
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    return '';
  }

  private formatDateLabel(parsedDate: Date | null, fallbackValue: string): string {
    if (!parsedDate) {
      return fallbackValue || 'Unknown date';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsedDate);
  }
}
