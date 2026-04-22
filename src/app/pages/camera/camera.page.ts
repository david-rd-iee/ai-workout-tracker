import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AlertController,
  IonButton,
  IonContent,
  IonSpinner,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { VideoAnalysisResult, SavedVideoAnalysisRecord } from '../../models/video-analysis.model';
import { VideoAnalysisService } from '../../services/video-analysis.service';
import { UserService } from '../../services/account/user.service';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-camera',
  templateUrl: './camera.page.html',
  styleUrls: ['./camera.page.scss'],
  standalone: true,
  imports: [
    HeaderComponent,
    IonContent,
    IonButton,
    IonSpinner,
    CommonModule,
  ],
})
export class CameraPage implements AfterViewInit, OnDestroy {
  @ViewChild('cameraVideo', { static: false }) cameraVideo?: ElementRef<HTMLVideoElement>;

  private readonly videoAnalysisService = inject(VideoAnalysisService);
  private readonly userService = inject(UserService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly navCtrl = inject(NavController);
  private readonly ngZone = inject(NgZone);

  hasCameraSupport = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  hasRecordingSupport = typeof MediaRecorder !== 'undefined';
  isLoading = false;
  isRecording = false;
  isAnalyzing = false;
  isUploading = false;
  errorMessage = '';
  analysisMessage = '';
  uploadMessage = '';
  assignedTrainerId = '';
  recordingDurationMs = 0;
  readonly maxRecordingDurationMs = 60_000;

  recordedVideoBlob: Blob | null = null;
  recordedVideoUrl: string | null = null;
  recordedAtMs: number | null = null;
  analysisResult: VideoAnalysisResult | null = null;
  savedRecord: SavedVideoAnalysisRecord | null = null;

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: BlobPart[] = [];
  private recordingTimerId: number | null = null;
  private ignoreNextRecorderStop = false;
  private destroyed = false;

  async ngAfterViewInit(): Promise<void> {
    await this.loadTrainerContext();
    await this.startCamera();
  }

  async ionViewDidEnter(): Promise<void> {
    await this.loadTrainerContext();
    if (!this.recordedVideoUrl && !this.mediaStream && !this.isRecording) {
      await this.startCamera();
    }
  }

  ionViewWillLeave(): void {
    this.cancelActiveRecording();
    this.stopCamera();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cancelActiveRecording();
    this.stopCamera();
    this.revokeRecordedVideoUrl();
  }

  get hasRecordedVideo(): boolean {
    return !!this.recordedVideoUrl && !!this.recordedVideoBlob;
  }

  get canShowSendButton(): boolean {
    return (
      !!this.assignedTrainerId &&
      !!this.recordedVideoBlob &&
      !!this.analysisResult &&
      !this.isAnalyzing
    );
  }

  get recordButtonDisabled(): boolean {
    return (
      !this.hasCameraSupport ||
      !this.hasRecordingSupport ||
      this.isLoading ||
      this.isAnalyzing ||
      this.isUploading
    );
  }

  get recordingTimeLabel(): string {
    return this.formatDuration(this.recordingDurationMs);
  }

  async retryCamera(): Promise<void> {
    this.stopCamera();
    await this.startCamera();
  }

  openAnalyzedVideos(): void {
    this.navCtrl.navigateForward('/analyzed-videos');
  }

  async startRecording(): Promise<void> {
    if (this.recordButtonDisabled || this.isRecording) {
      return;
    }

    if (!this.mediaStream) {
      await this.startCamera();
    }

    if (!this.mediaStream) {
      return;
    }

    this.clearRecordedSession();
    this.errorMessage = '';
    const preferredMimeType = this.resolveRecordingMimeType();

    try {
      this.recordedChunks = [];
      this.mediaRecorder = preferredMimeType
        ? new MediaRecorder(this.mediaStream, {
            mimeType: preferredMimeType,
            videoBitsPerSecond: 3_000_000,
          })
        : new MediaRecorder(this.mediaStream, {
            videoBitsPerSecond: 3_000_000,
          });

      const recorder = this.mediaRecorder;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        this.errorMessage = 'Recording failed. Please try again.';
        this.stopRecordingTimer();
        this.isRecording = false;
      };
      recorder.onstop = () => {
        this.ngZone.run(() => {
          const chunks = [...this.recordedChunks];
          this.recordedChunks = [];
          this.stopRecordingTimer();
          this.isRecording = false;

          const shouldIgnore = this.ignoreNextRecorderStop || this.destroyed;
          this.ignoreNextRecorderStop = false;
          if (this.mediaRecorder === recorder) {
            this.mediaRecorder = null;
          }

          if (shouldIgnore) {
            return;
          }

          const mimeType = recorder.mimeType || preferredMimeType || 'video/webm';
          void this.finishRecording(chunks, mimeType);
        });
      };

      recorder.start(250);
      this.isRecording = true;
      this.recordingDurationMs = 0;
      this.startRecordingTimer();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording could not start.';
      this.errorMessage = message;
    }
  }

  async stopRecording(): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return;
    }

    try {
      this.mediaRecorder.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording could not stop cleanly.';
      this.errorMessage = message;
      this.stopRecordingTimer();
      this.isRecording = false;
    }
  }

  async retakeRecording(): Promise<void> {
    if (this.isRecording || this.isAnalyzing || this.isUploading) {
      return;
    }

    this.clearRecordedSession();
    await this.startCamera();
  }

  async sendToTrainer(): Promise<void> {
    if (!this.canShowSendButton || this.isUploading || this.savedRecord) {
      return;
    }

    const currentUser = this.userService.getCurrentUser()();
    const clientId = String(currentUser?.uid || '').trim();
    if (!clientId || !this.recordedVideoBlob || !this.analysisResult || !this.recordedAtMs) {
      this.errorMessage = 'This recording is missing the data needed to upload it.';
      return;
    }

    this.isUploading = true;
    this.uploadMessage = 'Preparing upload...';
    this.errorMessage = '';

    try {
      const workoutName = await this.promptForWorkoutName();
      if (workoutName === null) {
        this.isUploading = false;
        this.uploadMessage = '';
        return;
      }

      this.savedRecord = await this.videoAnalysisService.saveAnalysisToTrainer({
        clientId,
        trainerId: this.assignedTrainerId,
        recordedAtMs: this.recordedAtMs,
        recordedVideo: this.recordedVideoBlob,
        analysis: this.analysisResult,
        workoutName,
        onProgress: (message) => {
          this.uploadMessage = message;
        },
      });
      this.uploadMessage = 'Analysis sent to trainer.';
      await this.showToast('Analysis sent to trainer.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.';
      this.errorMessage = message;
      this.uploadMessage = '';
      await this.showToast(message);
    } finally {
      this.isUploading = false;
    }
  }

  private async promptForWorkoutName(): Promise<string | null> {
    return new Promise<string | null>(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'Name this workout?',
        message: 'Enter a workout name, or skip to send without one.',
        inputs: [
          {
            name: 'workoutName',
            type: 'text',
            placeholder: 'Leg day, Upper body, Morning run...',
          },
        ],
        backdropDismiss: false,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => resolve(null),
          },
          {
            text: 'Skip',
            handler: () => resolve(''),
          },
          {
            text: 'Confirm',
            handler: (data: { workoutName?: string }) => {
              resolve(String(data?.workoutName || '').trim());
            },
          },
        ],
      });

      await alert.present();
    });
  }

  dominantMovementLabel(analysis: VideoAnalysisResult): string {
    return analysis.dominantMovement?.label ?? 'No dominant movement detected';
  }

  formatMetric(value: number | null, digits = 1, suffix = ''): string {
    if (value === null || !Number.isFinite(value)) {
      return 'N/A';
    }

    return `${value.toFixed(digits)}${suffix}`;
  }

  formatMilliseconds(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return 'N/A';
    }

    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}s`;
    }

    return `${Math.round(value)}ms`;
  }

  formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private async startCamera(): Promise<void> {
    if (
      !this.hasCameraSupport ||
      this.isLoading ||
      this.mediaStream ||
      !this.cameraVideo
    ) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      this.mediaStream = stream;
      await this.attachLivePreview(stream);
      void this.videoAnalysisService.warmPoseModel().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to access the camera.';
      this.errorMessage = `Camera access failed: ${message}`;
      this.stopCamera();
    } finally {
      this.isLoading = false;
    }
  }

  private stopCamera(): void {
    const video = this.cameraVideo?.nativeElement;
    if (video && this.mediaStream) {
      video.pause();
      video.srcObject = null;
      if (!this.recordedVideoUrl) {
        video.removeAttribute('src');
      }
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private async attachLivePreview(stream: MediaStream): Promise<void> {
    const video = this.cameraVideo?.nativeElement;
    if (!video) {
      return;
    }

    video.controls = false;
    video.muted = true;
    video.src = '';
    video.srcObject = stream;
    await video.play();
  }

  private async attachRecordedPreview(videoUrl: string): Promise<void> {
    const video = this.cameraVideo?.nativeElement;
    if (!video) {
      return;
    }

    video.pause();
    video.srcObject = null;
    video.controls = true;
    video.muted = true;
    video.src = videoUrl;
    video.load();
    await video.play().catch(() => undefined);
  }

  private async finishRecording(chunks: BlobPart[], mimeType: string): Promise<void> {
    if (chunks.length === 0) {
      this.errorMessage = 'No video was captured. Please try again.';
      return;
    }

    const recordedVideo = new Blob(chunks, { type: mimeType });
    this.recordedVideoBlob = recordedVideo;
    this.recordedAtMs = Date.now();
    this.stopCamera();
    this.revokeRecordedVideoUrl();
    this.recordedVideoUrl = URL.createObjectURL(recordedVideo);
    await this.attachRecordedPreview(this.recordedVideoUrl);
    await this.analyzeRecording(recordedVideo);
  }

  private async analyzeRecording(recordedVideo: Blob): Promise<void> {
    this.isAnalyzing = true;
    this.analysisMessage = 'Analyzing movement...';
    this.errorMessage = '';

    try {
      this.analysisResult = await this.videoAnalysisService.analyzeVideo(recordedVideo, (message) => {
        this.analysisMessage = message;
      });
      this.analysisMessage = 'Analysis ready.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pose analysis failed.';
      this.analysisResult = null;
      this.analysisMessage = '';
      this.errorMessage = message;
      await this.showToast(message);
    } finally {
      this.isAnalyzing = false;
    }
  }

  private async loadTrainerContext(): Promise<void> {
    const currentUser = this.userService.getCurrentUser()();
    const uid = String(currentUser?.uid || '').trim();
    if (!uid) {
      this.assignedTrainerId = '';
      return;
    }

    try {
      const userSummary = await this.userService.getUserSummaryDirectly(uid);
      this.assignedTrainerId = String(userSummary?.trainerId || '').trim();
    } catch {
      this.assignedTrainerId = '';
    }
  }

  private resolveRecordingMimeType(): string {
    if (typeof MediaRecorder === 'undefined') {
      return '';
    }

    const candidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];

    for (const candidate of candidates) {
      if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  private clearRecordedSession(): void {
    this.recordedVideoBlob = null;
    this.recordedAtMs = null;
    this.analysisResult = null;
    this.savedRecord = null;
    this.analysisMessage = '';
    this.uploadMessage = '';
    this.errorMessage = '';
    this.revokeRecordedVideoUrl();
  }

  private revokeRecordedVideoUrl(): void {
    if (this.recordedVideoUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.recordedVideoUrl);
    }
    this.recordedVideoUrl = null;
  }

  private startRecordingTimer(): void {
    this.stopRecordingTimer();
    const startedAt = Date.now();
    this.recordingTimerId = window.setInterval(() => {
      this.recordingDurationMs = Date.now() - startedAt;
      if (this.recordingDurationMs >= this.maxRecordingDurationMs) {
        void this.stopRecording();
      }
    }, 200);
  }

  private stopRecordingTimer(): void {
    if (this.recordingTimerId !== null) {
      clearInterval(this.recordingTimerId);
      this.recordingTimerId = null;
    }
  }

  private cancelActiveRecording(): void {
    this.stopRecordingTimer();
    this.isRecording = false;
    this.recordedChunks = [];

    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this.mediaRecorder = null;
      return;
    }

    this.ignoreNextRecorderStop = true;
    try {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onerror = null;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    } catch {
      // Ignore cleanup failures while tearing down the page.
    } finally {
      this.mediaRecorder = null;
    }
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'bottom',
    });
    await toast.present();
  }
}
