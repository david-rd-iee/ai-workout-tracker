import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  AlertController,
  IonButton,
  IonContent,
  IonSpinner,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { VideoAnalysisResult } from '../../models/video-analysis.model';
import { VideoAnalysisService } from '../../services/video-analysis.service';
import {
  VideoAnalysisUploadQueueJob,
  VideoAnalysisUploadQueueService,
} from '../../services/video-analysis-upload-queue.service';
import { UserService } from '../../services/account/user.service';
import { HeaderComponent } from '../../components/header/header.component';

type CameraFacingMode = 'user' | 'environment';

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
  private readonly videoAnalysisUploadQueueService = inject(VideoAnalysisUploadQueueService);
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
  uploadQueueJobs: VideoAnalysisUploadQueueJob[] = [];

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: BlobPart[] = [];
  private recordingTimerId: number | null = null;
  private ignoreNextRecorderStop = false;
  private destroyed = false;
  private queueStateSubscription: Subscription | null = null;
  private readonly isIPhone = typeof navigator !== 'undefined' && /iPhone/i.test(navigator.userAgent);
  cameraFacingMode: CameraFacingMode = 'environment';

  constructor() {
    this.queueStateSubscription = this.videoAnalysisUploadQueueService.state$.subscribe((state) => {
      this.uploadQueueJobs = state.jobs;
    });
  }

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
    this.queueStateSubscription?.unsubscribe();
    this.queueStateSubscription = null;
  }

  get hasRecordedVideo(): boolean {
    return !!this.recordedVideoUrl && !!this.recordedVideoBlob;
  }

  get canShowSendButton(): boolean {
    return (
      !!this.assignedTrainerId &&
      !!this.recordedVideoBlob &&
      !!this.analysisResult &&
      !this.isAnalyzing &&
      !this.isUploading
    );
  }

  get recordButtonDisabled(): boolean {
    return (
      !this.hasCameraSupport ||
      !this.hasRecordingSupport ||
      this.isLoading ||
      this.isAnalyzing
    );
  }

  get recordingTimeLabel(): string {
    return this.formatDuration(this.recordingDurationMs);
  }

  get showCameraSwitchButton(): boolean {
    return this.isIPhone && !!this.mediaStream && !this.hasRecordedVideo;
  }

  get cameraSwitchDisabled(): boolean {
    return this.isLoading || this.isRecording || this.isAnalyzing;
  }

  get cameraSwitchLabel(): string {
    return this.cameraFacingMode === 'environment' ? 'Front' : 'Back';
  }

  get activeQueueCount(): number {
    return this.uploadQueueJobs.filter((job) => job.status === 'queued' || job.status === 'processing').length;
  }

  get canClearFinishedUploads(): boolean {
    return this.uploadQueueJobs.some((job) => job.status === 'completed' || job.status === 'failed');
  }

  async retryCamera(): Promise<void> {
    this.stopCamera();
    await this.startCamera(this.cameraFacingMode);
  }

  openAnalyzedVideos(): void {
    this.navCtrl.navigateForward('/analyzed-videos');
  }

  async showAnalyzeWorkoutInfo(): Promise<void> {
    const alert = await this.alertCtrl.create({
      mode: 'ios',
      header: 'Analyze workout help',
      subHeader: 'Record one clear set for the best feedback',
      message: [
        '• Position your full body in frame before recording.',
        '• Record 3 to 8 reps from a stable camera angle.',
        '• Open Analyzed to review past uploads and coach notes.',
        '• Use Send to Trainer after analysis is complete.'
      ].join('\n'),
      buttons: ['Got it'],
      translucent: true,
    });

    await alert.present();
  }

  async toggleCameraFacingMode(): Promise<void> {
    if (!this.showCameraSwitchButton || this.cameraSwitchDisabled) {
      return;
    }

    const previousFacingMode = this.cameraFacingMode;
    const nextFacingMode: CameraFacingMode =
      previousFacingMode === 'environment' ? 'user' : 'environment';
    this.cameraFacingMode = nextFacingMode;

    this.stopCamera();
    await this.startCamera(nextFacingMode, true);

    if (this.mediaStream) {
      return;
    }

    // Fall back to the previous camera if the requested lens is unavailable.
    this.cameraFacingMode = previousFacingMode;
    await this.startCamera(previousFacingMode, true);
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
    this.recordedChunks = [];

    const mimeCandidates = this.buildRecordingMimeCandidates();
    const hasTypeSupportApi =
      typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
    const mimeSupport = mimeCandidates.map((candidate) => ({
      mimeType: candidate,
      supported: hasTypeSupportApi ? MediaRecorder.isTypeSupported(candidate) : 'unknown',
    }));
    const supportedMimeTypes = mimeSupport
      .filter((entry) => entry.supported === true)
      .map((entry) => entry.mimeType);
    const orderedAttemptMimeTypes = Array.from(
      new Set<string>([
        ...supportedMimeTypes,
        ...mimeCandidates,
        '',
      ])
    );

    this.logCameraDebug('MediaRecorder MIME support check', {
      isIPhone: this.isIPhone,
      hasTypeSupportApi,
      mimeSupport,
      orderedAttempts: orderedAttemptMimeTypes.map((mimeType) => mimeType || '(browser-default)'),
    });

    let startedRecorder: MediaRecorder | null = null;
    let selectedRequestedMimeType = '';

    for (const requestedMimeType of orderedAttemptMimeTypes) {
      const requestedLabel = requestedMimeType || '(browser-default)';
      try {
        const recorder = requestedMimeType
          ? new MediaRecorder(this.mediaStream, {
              mimeType: requestedMimeType,
              videoBitsPerSecond: 3_000_000,
            })
          : new MediaRecorder(this.mediaStream, {
              videoBitsPerSecond: 3_000_000,
            });

        this.bindRecorderEvents(recorder, requestedMimeType);
        recorder.start(250);

        startedRecorder = recorder;
        selectedRequestedMimeType = requestedMimeType;
        this.logCameraDebug('Recording started', {
          requestedMimeType: requestedLabel,
          activeMimeType: recorder.mimeType || '(empty)',
          streamTrackSummary: this.mediaStream.getTracks().map((track) => `${track.kind}:${track.readyState}`),
        });
        break;
      } catch (error) {
        this.logCameraError('startRecording attempt failed', error, {
          requestedMimeType: requestedLabel,
          activeStream: !!this.mediaStream,
        });
      }
    }

    if (!startedRecorder) {
      this.errorMessage = 'Recording could not start on this iPhone/browser. Please retry.';
      return;
    }

    this.mediaRecorder = startedRecorder;
    this.recordingDurationMs = 0;
    this.isRecording = true;
    this.startRecordingTimer();
    this.logCameraDebug('Using recorder MIME', {
      requestedMimeType: selectedRequestedMimeType || '(browser-default)',
      recorderMimeType: startedRecorder.mimeType || '(empty)',
    });
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
    if (this.isRecording || this.isAnalyzing) {
      return;
    }

    this.clearRecordedSession();
    await this.startCamera();
  }

  async sendToTrainer(): Promise<void> {
    if (!this.canShowSendButton || this.isUploading) {
      return;
    }

    const currentUser = this.userService.getCurrentUser()();
    const clientId = String(currentUser?.uid || '').trim();
    if (!clientId || !this.recordedVideoBlob || !this.analysisResult || !this.recordedAtMs) {
      this.errorMessage = 'This recording is missing the data needed to upload it.';
      return;
    }

    this.isUploading = true;
    this.uploadMessage = 'Sending analysis to trainer...';
    this.errorMessage = '';

    try {
      const workoutName = await this.promptForWorkoutName();
      if (workoutName === null) {
        this.isUploading = false;
        this.uploadMessage = '';
        return;
      }

      const savedRecord = await this.videoAnalysisService.saveAnalysisToTrainer({
        clientId,
        trainerId: this.assignedTrainerId,
        recordedAtMs: this.recordedAtMs,
        recordedVideo: this.recordedVideoBlob,
        analysis: this.analysisResult,
        workoutName,
        onProgress: (message) => {
          this.uploadMessage = message || 'Sending analysis to trainer...';
        },
      });

      this.uploadMessage = '';
      await this.showToast('Analysis sent to trainer.');
      this.logCameraDebug('Analysis sent to trainer', {
        savedRecordId: savedRecord.documentId,
        canView: savedRecord.canView,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.';
      this.errorMessage = message;
      this.uploadMessage = '';
      await this.showToast(message);
    } finally {
      this.isUploading = false;
    }
  }

  clearFinishedUploads(): void {
    this.videoAnalysisUploadQueueService.clearFinishedJobs();
  }

  trackQueueJob(_index: number, job: VideoAnalysisUploadQueueJob): string {
    return job.id;
  }

  uploadQueueTitle(job: VideoAnalysisUploadQueueJob): string {
    return job.workoutName || `Workout ${this.formatDateTime(job.createdAtIso)}`;
  }

  formatDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Unknown time';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
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

  private async startCamera(
    preferredFacingMode: CameraFacingMode = this.cameraFacingMode,
    preferExactFacingMode = false,
  ): Promise<void> {
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
    const constraintAttempts = this.buildCameraConstraintAttempts(preferredFacingMode, preferExactFacingMode);
    this.logCameraDebug('Requesting camera stream via getUserMedia', {
      preferredFacingMode,
      preferExactFacingMode,
      attemptCount: constraintAttempts.length,
      hasCameraSupport: this.hasCameraSupport,
      hasRecordingSupport: this.hasRecordingSupport,
      secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
      isIPhone: this.isIPhone,
    });

    try {
      let stream: MediaStream | null = null;
      let selectedFacingMode: CameraFacingMode = preferredFacingMode;
      let lastError: unknown = null;

      for (const attempt of constraintAttempts) {
        try {
          this.logCameraDebug('Camera stream attempt', {
            requestedFacingMode: attempt.facingMode,
            useExactFacingMode: attempt.useExact,
            constraints: attempt.constraints,
          });
          stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
          selectedFacingMode = attempt.facingMode;
          break;
        } catch (error) {
          lastError = error;
          this.logCameraError('startCamera getUserMedia attempt failed', error, {
            requestedFacingMode: attempt.facingMode,
            useExactFacingMode: attempt.useExact,
          });
        }
      }

      if (!stream) {
        throw lastError instanceof Error ? lastError : new Error('Unable to access the camera.');
      }

      this.mediaStream = stream;
      const videoTrackSettings = stream.getVideoTracks()[0]?.getSettings();
      const trackFacingMode = videoTrackSettings?.facingMode;
      if (trackFacingMode === 'user' || trackFacingMode === 'environment') {
        this.cameraFacingMode = trackFacingMode;
      } else {
        this.cameraFacingMode = selectedFacingMode;
      }
      this.logCameraDebug('getUserMedia succeeded', {
        trackCount: stream.getTracks().length,
        videoTrackSettings,
        cameraFacingMode: this.cameraFacingMode,
      });
      await this.attachLivePreview(stream);
      void this.videoAnalysisService.warmPoseModel().catch(() => undefined);
    } catch (error) {
      this.logCameraError('startCamera getUserMedia failed', error, {
        preferredFacingMode,
        preferExactFacingMode,
      });
      this.errorMessage = this.buildCameraAccessErrorMessage(error);
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

  private buildRecordingMimeCandidates(): string[] {
    const iphoneFirst = [
      'video/mp4;codecs="avc1.42E01E"',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const webmFirst = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs="avc1.42E01E"',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];

    return this.isIPhone ? iphoneFirst : webmFirst;
  }

  private buildCameraConstraintAttempts(
    preferredFacingMode: CameraFacingMode,
    preferExactFacingMode: boolean,
  ): Array<{
    facingMode: CameraFacingMode;
    useExact: boolean;
    constraints: MediaStreamConstraints;
  }> {
    const attempts: Array<{
      facingMode: CameraFacingMode;
      useExact: boolean;
      constraints: MediaStreamConstraints;
    }> = [];
    const pushAttempt = (facingMode: CameraFacingMode, useExact: boolean): void => {
      attempts.push({
        facingMode,
        useExact,
        constraints: {
          video: {
            facingMode: useExact ? { exact: facingMode } : { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        },
      });
    };

    if (preferExactFacingMode) {
      pushAttempt(preferredFacingMode, true);
    }
    pushAttempt(preferredFacingMode, false);
    pushAttempt(this.getOppositeFacingMode(preferredFacingMode), false);

    return attempts;
  }

  private getOppositeFacingMode(facingMode: CameraFacingMode): CameraFacingMode {
    return facingMode === 'environment' ? 'user' : 'environment';
  }

  private bindRecorderEvents(recorder: MediaRecorder, requestedMimeType: string): void {
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    recorder.onerror = (event: Event) => {
      const mediaRecorderEvent = event as Event & { error?: unknown };
      this.logCameraError('MediaRecorder runtime error', mediaRecorderEvent.error ?? event, {
        requestedMimeType: requestedMimeType || '(browser-default)',
        activeMimeType: recorder.mimeType || '(empty)',
      });
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

        const mimeType = recorder.mimeType || requestedMimeType || this.getRecordingFallbackMimeType();
        this.logCameraDebug('Recorder stopped', {
          outputMimeType: mimeType,
          chunkCount: chunks.length,
          requestedMimeType: requestedMimeType || '(browser-default)',
          recorderMimeType: recorder.mimeType || '(empty)',
        });
        void this.finishRecording(chunks, mimeType);
      });
    };
  }

  private getRecordingFallbackMimeType(): string {
    return this.isIPhone ? 'video/mp4' : 'video/webm';
  }

  private buildCameraAccessErrorMessage(error: unknown): string {
    const errorName = this.extractErrorName(error);
    if (errorName === 'NotAllowedError') {
      return 'Camera access failed: permission denied. Please allow camera access in iPhone Settings.';
    }
    if (errorName === 'NotFoundError') {
      return 'Camera access failed: no camera was found on this device.';
    }
    if (errorName === 'NotReadableError') {
      return 'Camera access failed: the camera is already in use by another app.';
    }
    if (errorName === 'OverconstrainedError') {
      return 'Camera access failed: this camera does not support the requested capture settings.';
    }
    if (errorName === 'SecurityError') {
      return 'Camera access failed: this context is not allowed to use camera APIs.';
    }

    const message = error instanceof Error ? error.message : 'Unable to access the camera.';
    return `Camera access failed: ${message}`;
  }

  private extractErrorName(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }
    if (!('name' in error)) {
      return '';
    }

    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }

  private logCameraDebug(message: string, details?: Record<string, unknown>): void {
    if (details) {
      console.info(`[AnalyzerCamera] ${message}`, details);
      return;
    }

    console.info(`[AnalyzerCamera] ${message}`);
  }

  private logCameraError(message: string, error: unknown, details?: Record<string, unknown>): void {
    const normalizedError = this.normalizeCameraError(error);
    if (details) {
      console.error(`[AnalyzerCamera] ${message}`, {
        ...details,
        ...normalizedError,
      });
      return;
    }

    console.error(`[AnalyzerCamera] ${message}`, normalizedError);
  }

  private normalizeCameraError(error: unknown): Record<string, unknown> {
    if (error instanceof DOMException) {
      const maybeConstraint = error as DOMException & { constraint?: string };
      return {
        errorName: error.name,
        errorMessage: error.message,
        errorCode: error.code,
        constraint: maybeConstraint.constraint ?? null,
      };
    }

    if (error instanceof Error) {
      return {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack ?? null,
      };
    }

    if (typeof error === 'string') {
      return {
        errorMessage: error,
      };
    }

    return {
      errorValue: error,
    };
  }

  private clearRecordedSession(): void {
    this.recordedVideoBlob = null;
    this.recordedAtMs = null;
    this.analysisResult = null;
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
