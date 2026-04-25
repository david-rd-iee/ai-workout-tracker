import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonIcon, IonSpinner, NavController } from '@ionic/angular/standalone';
import { AccountService } from '../../services/account/account.service';
import { VideoPlaybackCacheService } from '../../services/video-playback-cache.service';
import {
  TrainerClientVideoAnalysisItem,
  TrainerClientVideoAnalysisService,
} from '../../services/trainer-client-video-analysis.service';
import { addIcons } from 'ionicons';
import { analyticsOutline, chevronForwardOutline } from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';

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
  private readonly accountService = inject(AccountService);
  private readonly videoPlaybackCacheService = inject(VideoPlaybackCacheService);
  private readonly trainerClientVideoAnalysisService = inject(TrainerClientVideoAnalysisService);
  private readonly navCtrl = inject(NavController);

  isLoading = true;
  errorMessage = '';
  clientId = '';
  clientName = '';
  videos: TrainerClientVideoAnalysisItem[] = [];
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

  openVideo(video: TrainerClientVideoAnalysisItem): void {
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
      const allVideos = await this.trainerClientVideoAnalysisService.listClientVideoAnalyses(
        trainerId,
        this.clientId
      );

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
    pendingVideos: TrainerClientVideoAnalysisItem[],
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
}
