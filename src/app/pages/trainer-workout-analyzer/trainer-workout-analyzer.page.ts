import { AfterViewChecked, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonMenu,
  IonMenuButton,
  IonMenuToggle,
  IonSpinner,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { AccountService } from '../../services/account/account.service';
import { addIcons } from 'ionicons';
import { arrowBackOutline, pauseOutline, playOutline } from 'ionicons/icons';

type WorkoutAnalysisMenuItem = {
  id: string;
  label: string;
  recordingUrl: string;
  overlayUrl: string;
};

@Component({
  selector: 'app-trainer-workout-analyzer',
  standalone: true,
  templateUrl: './trainer-workout-analyzer.page.html',
  styleUrls: ['./trainer-workout-analyzer.page.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonMenu,
    IonMenuToggle,
    IonMenuButton,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
})
export class TrainerWorkoutAnalyzerPage implements OnInit, AfterViewChecked {
  @ViewChild('recordingVideo') private recordingVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayVideo') private overlayVideoRef?: ElementRef<HTMLVideoElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly accountService = inject(AccountService);
  private readonly firestore = inject(Firestore);
  private readonly navCtrl = inject(NavController);

  readonly contentId = 'trainer-workout-analyzer-content';

  isLoading = true;
  errorMessage = '';
  clientId = '';
  clientName = '';
  workoutAnalyses: WorkoutAnalysisMenuItem[] = [];
  selectedAnalysis: WorkoutAnalysisMenuItem | null = null;
  videoMode: 'recording' | 'overlay' = 'recording';
  isSwitchingVideo = false;
  isPlaying = false;
  currentTimeSeconds = 0;
  durationSeconds = 0;

  private pendingVideoSelectionSync = false;

  constructor() {
    addIcons({
      arrowBackOutline,
      playOutline,
      pauseOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.clientId = String(this.route.snapshot.paramMap.get('clientId') || '').trim();
    this.clientName = String(this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    await this.loadWorkoutAnalyses();
  }

  ngAfterViewChecked(): void {
    if (!this.pendingVideoSelectionSync) {
      return;
    }

    this.pendingVideoSelectionSync = false;
    void this.initializeSelectedVideoState();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/client-workout-analysis', {
      animated: true,
      animationDirection: 'back',
    });
  }

  get activeAnalysisLabel(): string {
    return this.selectedAnalysis?.label || '';
  }

  get canToggleOverlay(): boolean {
    return !!this.selectedAnalysis?.overlayUrl;
  }

  get isRecordingMode(): boolean {
    return this.videoMode === 'recording';
  }

  get progressPercent(): number {
    if (!this.durationSeconds || !Number.isFinite(this.durationSeconds)) {
      return 0;
    }

    return Math.max(0, Math.min((this.currentTimeSeconds / this.durationSeconds) * 100, 100));
  }

  selectAnalysis(analysis: WorkoutAnalysisMenuItem): void {
    this.selectedAnalysis = analysis;
    this.videoMode = 'recording';
    this.isPlaying = false;
    this.currentTimeSeconds = 0;
    this.durationSeconds = 0;
    this.pendingVideoSelectionSync = true;
  }

  async showRecording(): Promise<void> {
    await this.switchVideoMode('recording');
  }

  async showOverlay(): Promise<void> {
    if (!this.canToggleOverlay) {
      return;
    }

    await this.switchVideoMode('overlay');
  }

  async togglePlayback(): Promise<void> {
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    this.applySilentVideoConfig(activeVideo);

    if (activeVideo.paused || activeVideo.ended) {
      await activeVideo.play().catch(() => undefined);
      return;
    }

    activeVideo.pause();
  }

  onSeekInput(value: string | number): void {
    const nextPercent = Number(value);
    if (!Number.isFinite(nextPercent)) {
      return;
    }

    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo || !this.durationSeconds) {
      return;
    }

    const nextTime = Math.max(0, Math.min((nextPercent / 100) * this.durationSeconds, this.durationSeconds));
    activeVideo.currentTime = nextTime;
    this.currentTimeSeconds = nextTime;
  }

  onVideoTimeUpdate(): void {
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    this.applySilentVideoConfig(activeVideo);
    this.currentTimeSeconds = Number.isFinite(activeVideo.currentTime) ? activeVideo.currentTime : 0;
    this.durationSeconds = Number.isFinite(activeVideo.duration) ? activeVideo.duration : this.durationSeconds;
  }

  onVideoMetadataLoaded(): void {
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    this.applySilentVideoConfig(activeVideo);
    this.durationSeconds = Number.isFinite(activeVideo.duration) ? activeVideo.duration : 0;
  }

  onVideoPlay(): void {
    this.isPlaying = true;
  }

  onVideoPause(): void {
    this.isPlaying = false;
  }

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '0:00';
    }

    const rounded = Math.floor(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
  }

  private async loadWorkoutAnalyses(): Promise<void> {
    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId) {
      this.errorMessage = 'You must be signed in to view workout analyses.';
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
      const analysesRef = collection(
        this.firestore,
        `trainers/${trainerId}/clients/${this.clientId}/videoAnalysis`
      );
      const snapshot = await getDocs(analysesRef);

      this.workoutAnalyses = snapshot.docs
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
          const overlayUrl = typeof overlayVideo?.['downloadUrl'] === 'string'
            ? overlayVideo['downloadUrl'].trim()
            : '';
          const fallbackLabel = analyzedAtIso || String(data['recordedAt'] || '').trim() || docSnap.id;

          return {
            id: docSnap.id,
            label: workoutName ? `${fallbackLabel}:${workoutName}` : fallbackLabel,
            analyzedAtIso: fallbackLabel,
            recordingUrl,
            overlayUrl,
          };
        })
        .filter((analysis) => !!analysis.recordingUrl)
        .sort((left, right) => right.analyzedAtIso.localeCompare(left.analyzedAtIso))
        .map(({ id, label, recordingUrl, overlayUrl }) => ({ id, label, recordingUrl, overlayUrl }));

      this.selectedAnalysis = this.workoutAnalyses[0] ?? null;
      this.videoMode = 'recording';
      this.pendingVideoSelectionSync = !!this.selectedAnalysis;
    } catch (error) {
      console.error('[TrainerWorkoutAnalyzerPage] Failed to load workout analyses:', error);
      this.errorMessage = 'Unable to load workout analyses right now.';
    } finally {
      this.isLoading = false;
    }
  }

  private async initializeSelectedVideoState(): Promise<void> {
    const recordingVideo = this.recordingVideoRef?.nativeElement;
    const overlayVideo = this.overlayVideoRef?.nativeElement;
    if (!recordingVideo) {
      this.pendingVideoSelectionSync = true;
      return;
    }

    recordingVideo.currentTime = 0;
    recordingVideo.pause();
    this.applySilentVideoConfig(recordingVideo);
    if (overlayVideo) {
      overlayVideo.currentTime = 0;
      overlayVideo.pause();
      this.applySilentVideoConfig(overlayVideo);
    }

    await this.waitForMetadata(recordingVideo).catch(() => undefined);
    this.durationSeconds = Number.isFinite(recordingVideo.duration) ? recordingVideo.duration : 0;
    this.currentTimeSeconds = 0;
    void recordingVideo.play().catch(() => undefined);
  }

  private async switchVideoMode(targetMode: 'recording' | 'overlay'): Promise<void> {
    if (!this.selectedAnalysis || this.videoMode === targetMode || this.isSwitchingVideo) {
      return;
    }

    const currentVideo = this.getVideoElement(this.videoMode);
    const targetVideo = this.getVideoElement(targetMode);
    if (!targetVideo) {
      return;
    }

    this.isSwitchingVideo = true;

    try {
      const currentTime = currentVideo?.currentTime ?? 0;
      const wasPlaying = !!currentVideo && !currentVideo.paused && !currentVideo.ended;

      await this.waitForMetadata(targetVideo);
      this.applySilentVideoConfig(targetVideo);

      const safeTime = Math.max(
        0,
        Math.min(currentTime, Math.max((targetVideo.duration || currentTime) - 0.05, 0))
      );
      targetVideo.currentTime = safeTime;
      this.currentTimeSeconds = safeTime;
      this.durationSeconds = Number.isFinite(targetVideo.duration) ? targetVideo.duration : this.durationSeconds;

      if (wasPlaying) {
        await targetVideo.play().catch(() => undefined);
      } else {
        targetVideo.pause();
      }

      this.videoMode = targetMode;

      if (currentVideo && currentVideo !== targetVideo) {
        currentVideo.pause();
      }
    } finally {
      this.isSwitchingVideo = false;
    }
  }

  private getVideoElement(mode: 'recording' | 'overlay'): HTMLVideoElement | null {
    if (mode === 'overlay') {
      return this.overlayVideoRef?.nativeElement ?? null;
    }

    return this.recordingVideoRef?.nativeElement ?? null;
  }

  private applySilentVideoConfig(video: HTMLVideoElement): void {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
  }

  private async waitForMetadata(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.applySilentVideoConfig(video);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Video metadata failed to load.'));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }
}
