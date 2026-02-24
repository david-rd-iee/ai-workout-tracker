import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

type PoseLandmark = { x: number; y: number; z?: number; visibility?: number };
type PoseResult = { landmarks?: PoseLandmark[][] };
type PoseLandmarkerInstance = {
  detectForVideo(video: HTMLVideoElement, timestamp: number): PoseResult;
  close?: () => void;
};
type PoseLandmarkerCtor = {
  createFromOptions(
    resolver: unknown,
    options: {
      baseOptions: { modelAssetPath: string; delegate?: 'GPU' | 'CPU' };
      runningMode: 'VIDEO';
      numPoses: number;
      minPoseDetectionConfidence?: number;
      minPosePresenceConfidence?: number;
      minTrackingConfidence?: number;
    }
  ): Promise<PoseLandmarkerInstance>;
};
type FilesetResolverApi = typeof FilesetResolver;
type VisionBundle = {
  PoseLandmarker: PoseLandmarkerCtor;
  FilesetResolver: FilesetResolverApi;
};

@Component({
  selector: 'app-camera',
  templateUrl: './camera.page.html',
  styleUrls: ['./camera.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonText,
    CommonModule,
  ],
})
export class CameraPage implements AfterViewInit, OnDestroy {
  @ViewChild('cameraVideo', { static: false }) cameraVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('skeletonCanvas', { static: false }) skeletonCanvas?: ElementRef<HTMLCanvasElement>;

  isLoading = false;
  errorMessage = '';
  hasCameraSupport = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  private mediaStream: MediaStream | null = null;
  private poseLandmarker: PoseLandmarkerInstance | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;
  private modelLoading = false;
  private readonly mediapipeVersion = '0.10.21';

  private readonly poseConnections: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 7],
    [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
    [11, 12],
    [11, 13], [13, 15],
    [12, 14], [14, 16],
    [15, 17], [15, 19], [15, 21],
    [16, 18], [16, 20], [16, 22],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [27, 29], [29, 31],
    [24, 26], [26, 28], [28, 30], [30, 32],
    [27, 31], [28, 32],
  ];

  async ngAfterViewInit(): Promise<void> {
    await this.startCamera();
  }

  async ionViewDidEnter(): Promise<void> {
    if (!this.mediaStream) {
      await this.startCamera();
    }
  }

  ionViewWillLeave(): void {
    this.stopCamera();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  async retryCamera(): Promise<void> {
    this.stopCamera();
    await this.startCamera();
  }

  private async startCamera(): Promise<void> {
    if (!this.hasCameraSupport || this.isLoading || this.mediaStream || !this.cameraVideo) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      this.mediaStream = stream;
      const videoElement = this.cameraVideo.nativeElement;
      videoElement.srcObject = stream;
      await videoElement.play();
      await this.initPoseLandmarker();
      this.startPoseLoop();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to access camera.';
      this.errorMessage = `Camera access failed: ${message}`;
      this.stopCamera();
    } finally {
      this.isLoading = false;
    }
  }

  private stopCamera(): void {
    this.stopPoseLoop();
    this.clearSkeleton();

    const videoElement = this.cameraVideo?.nativeElement;
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.poseLandmarker?.close?.();
    this.poseLandmarker = null;
    this.lastVideoTime = -1;
  }

  private async initPoseLandmarker(): Promise<void> {
    if (this.poseLandmarker || this.modelLoading) {
      return;
    }

    this.modelLoading = true;
    try {
      const vision = await this.loadVisionBundle();
      const visionResolver = await vision.FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.mediapipeVersion}/wasm`
      );
      this.poseLandmarker = await vision.PoseLandmarker.createFromOptions(visionResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pose model failed to initialize.';
      this.errorMessage = `Pose detection unavailable: ${message}`;
    } finally {
      this.modelLoading = false;
    }
  }

  private async loadVisionBundle(): Promise<VisionBundle> {
    return {
      FilesetResolver,
      PoseLandmarker,
    };
  }

  private startPoseLoop(): void {
    if (!this.poseLandmarker || !this.cameraVideo) {
      return;
    }
    this.stopPoseLoop();
    const processFrame = () => {
      this.detectAndDrawPose();
      this.rafId = requestAnimationFrame(processFrame);
    };
    this.rafId = requestAnimationFrame(processFrame);
  }

  private stopPoseLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private detectAndDrawPose(): void {
    if (!this.poseLandmarker || !this.cameraVideo || !this.skeletonCanvas) {
      return;
    }

    const video = this.cameraVideo.nativeElement;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.clearSkeleton();
      return;
    }

    if (video.currentTime === this.lastVideoTime) {
      return;
    }
    this.lastVideoTime = video.currentTime;
    this.resizeCanvasToVideo();

    const result = this.poseLandmarker.detectForVideo(video, performance.now());
    const landmarks = result.landmarks?.[0] ?? [];
    if (landmarks.length === 0) {
      this.clearSkeleton();
      return;
    }

    this.drawSkeleton(landmarks);
  }

  private resizeCanvasToVideo(): void {
    if (!this.cameraVideo || !this.skeletonCanvas) {
      return;
    }
    const video = this.cameraVideo.nativeElement;
    const canvas = this.skeletonCanvas.nativeElement;
    const width = video.videoWidth || video.clientWidth;
    const height = video.videoHeight || video.clientHeight;
    if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  private drawSkeleton(landmarks: PoseLandmark[]): void {
    if (!this.skeletonCanvas) {
      return;
    }
    const canvas = this.skeletonCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#20c997';
    ctx.fillStyle = '#20c997';

    for (const [start, end] of this.poseConnections) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!this.isVisibleLandmark(a) || !this.isVisibleLandmark(b)) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }

    for (const point of landmarks) {
      if (!this.isVisibleLandmark(point)) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private isVisibleLandmark(point: PoseLandmark | undefined): point is PoseLandmark {
    if (!point) {
      return false;
    }
    const visibility = point.visibility ?? 1;
    return visibility > 0.4;
  }

  private clearSkeleton(): void {
    if (!this.skeletonCanvas) {
      return;
    }
    const canvas = this.skeletonCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
