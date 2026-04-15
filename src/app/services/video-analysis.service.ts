import { Injectable, inject } from '@angular/core';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Firestore, doc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { FileUploadService } from './file-upload.service';
import {
  BackAngleSummary,
  DominantMovementSummary,
  ElbowFlareSummary,
  JointRangeSummary,
  KneeValgusSummary,
  RepCountSummary,
  SavedVideoAnalysisRecord,
  SymmetryPairSummary,
  TempoSummary,
  TrunkLeanSummary,
  VideoAnalysisFrame,
  VideoAnalysisPoint,
  VideoAnalysisResult,
  VideoAnalysisSeriesPoint,
  VideoCompressionResult,
  VideoLandmarkName,
} from '../models/video-analysis.model';

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
type FrameMetrics = {
  leftElbow: number | null;
  rightElbow: number | null;
  leftShoulder: number | null;
  rightShoulder: number | null;
  leftHip: number | null;
  rightHip: number | null;
  leftKnee: number | null;
  rightKnee: number | null;
  trunkLean: number | null;
  backAngle: number | null;
  leftElbowFlare: number | null;
  rightElbowFlare: number | null;
  kneeValgusRatio: number | null;
};
type DominantSignalCandidate = {
  signal: string;
  label: string;
  series: VideoAnalysisSeriesPoint[];
  amplitude: number;
};
type NumericSeriesPoint = { timeMs: number; value: number };
type ExtremaPoint = NumericSeriesPoint & { type: 'min' | 'max' };
type ProgressCallback = (message: string) => void;

const LANDMARK_INDEX_MAP: Record<VideoLandmarkName, number> = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

const OVERLAY_CONNECTIONS: Array<[VideoLandmarkName, VideoLandmarkName]> = [
  ['nose', 'leftShoulder'],
  ['nose', 'rightShoulder'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

@Injectable({
  providedIn: 'root',
})
export class VideoAnalysisService {
  private readonly firestore = inject(Firestore);
  private readonly fileUploadService = inject(FileUploadService);

  private poseLandmarker: PoseLandmarkerInstance | null = null;
  private poseLoaderPromise: Promise<void> | null = null;
  private readonly mediapipeVersion = '0.10.21';
  private readonly sampleRateHz = 8;
  private readonly inlineLandmarksLimitBytes = 300_000;
  private readonly inlineJointAnglesLimitBytes = 350_000;

  async warmPoseModel(): Promise<void> {
    await this.ensurePoseLandmarker();
  }

  async analyzeVideo(
    recordedVideo: Blob,
    onProgress?: ProgressCallback
  ): Promise<VideoAnalysisResult> {
    await this.ensurePoseLandmarker();
    if (!this.poseLandmarker) {
      throw new Error('Pose analysis is not available on this device right now.');
    }

    const analysisVideo = document.createElement('video');
    analysisVideo.preload = 'auto';
    analysisVideo.muted = true;
    analysisVideo.playsInline = true;
    const objectUrl = URL.createObjectURL(recordedVideo);

    try {
      analysisVideo.src = objectUrl;
      analysisVideo.load();
      await this.waitForVideoMetadata(analysisVideo);

      const durationMs = Math.max(0, Math.round((analysisVideo.duration || 0) * 1000));
      const sampleTimes = this.buildSampleTimes(durationMs, this.sampleRateHz);
      const bodyLandmarks: VideoAnalysisFrame[] = [];
      const jointAngles = this.createJointAngleSeries();
      const elbowFlareSeries = {
        left: [] as VideoAnalysisSeriesPoint[],
        right: [] as VideoAnalysisSeriesPoint[],
      };
      const kneeValgusSeries: VideoAnalysisSeriesPoint[] = [];

      for (let index = 0; index < sampleTimes.length; index += 1) {
        const timeMs = sampleTimes[index];

        if (onProgress && (index === 0 || index === sampleTimes.length - 1 || index % 6 === 0)) {
          onProgress(`Analyzing movement ${index + 1} of ${sampleTimes.length}...`);
        }

        await this.seekVideo(analysisVideo, timeMs / 1000);
        const result = this.poseLandmarker.detectForVideo(analysisVideo, timeMs);
        const pose = result.landmarks?.[0] ?? [];
        if (pose.length === 0) {
          continue;
        }

        const selectedLandmarks = this.pickRelevantLandmarks(pose);
        if (!this.hasEnoughLandmarks(selectedLandmarks)) {
          continue;
        }

        bodyLandmarks.push({
          timeMs,
          landmarks: selectedLandmarks,
        });

        const metrics = this.computeFrameMetrics(selectedLandmarks);
        jointAngles.leftElbow.push(this.createSeriesPoint(timeMs, metrics.leftElbow));
        jointAngles.rightElbow.push(this.createSeriesPoint(timeMs, metrics.rightElbow));
        jointAngles.leftShoulder.push(this.createSeriesPoint(timeMs, metrics.leftShoulder));
        jointAngles.rightShoulder.push(this.createSeriesPoint(timeMs, metrics.rightShoulder));
        jointAngles.leftHip.push(this.createSeriesPoint(timeMs, metrics.leftHip));
        jointAngles.rightHip.push(this.createSeriesPoint(timeMs, metrics.rightHip));
        jointAngles.leftKnee.push(this.createSeriesPoint(timeMs, metrics.leftKnee));
        jointAngles.rightKnee.push(this.createSeriesPoint(timeMs, metrics.rightKnee));
        jointAngles.trunkLean.push(this.createSeriesPoint(timeMs, metrics.trunkLean));
        jointAngles.backAngle.push(this.createSeriesPoint(timeMs, metrics.backAngle));
        elbowFlareSeries.left.push(this.createSeriesPoint(timeMs, metrics.leftElbowFlare));
        elbowFlareSeries.right.push(this.createSeriesPoint(timeMs, metrics.rightElbowFlare));
        kneeValgusSeries.push(this.createSeriesPoint(timeMs, metrics.kneeValgusRatio));
      }

      const dominantMovement = this.identifyDominantMovement(jointAngles);
      const repCount = this.buildRepCountSummary(dominantMovement);
      const tempo = this.buildTempoSummary(repCount);
      const trunkLean = this.buildTrunkLeanSummary(jointAngles.trunkLean);
      const backAngle = this.buildBackAngleSummary(jointAngles.backAngle);
      const kneeValgus = this.buildKneeValgusSummary(kneeValgusSeries);
      const elbowFlare = this.buildElbowFlareSummary(elbowFlareSeries.left, elbowFlareSeries.right);
      const symmetry = this.buildSymmetrySummary(jointAngles);
      const rangeOfMotion = this.buildRangeOfMotionSummary(jointAngles, dominantMovement);

      return {
        analyzedAtIso: new Date().toISOString(),
        durationMs,
        sampleRateHz: this.sampleRateHz,
        framesRequested: sampleTimes.length,
        framesAnalyzed: bodyLandmarks.length,
        bodyLandmarks,
        jointAnglesOverTime: jointAngles,
        dominantMovement,
        repCount,
        tempo,
        rangeOfMotion,
        symmetry,
        posture: {
          trunkLean,
          kneeValgus,
          elbowFlare,
          backAngle,
        },
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
      analysisVideo.pause();
      analysisVideo.removeAttribute('src');
      analysisVideo.load();
    }
  }

  async saveAnalysisToTrainer(options: {
    clientId: string;
    trainerId: string;
    recordedAtMs: number;
    recordedVideo: Blob;
    analysis: VideoAnalysisResult;
    workoutName?: string;
    onProgress?: ProgressCallback;
  }): Promise<SavedVideoAnalysisRecord> {
    const clientId = String(options.clientId || '').trim();
    const trainerId = String(options.trainerId || '').trim();
    const recordedAtMs = Number(options.recordedAtMs || Date.now());
    const workoutName = String(options.workoutName || '').trim();

    if (!clientId) {
      throw new Error('A client ID is required before sending this analysis.');
    }

    if (!trainerId) {
      throw new Error('No trainer is assigned to this user yet.');
    }

    const docId = String(recordedAtMs);
    const basePath = `trainers/${trainerId}/clients/${clientId}/videoAnalysis/${docId}`;

    options.onProgress?.('Compressing video...');
    const compressedVideo = await this.compressVideo(options.recordedVideo);
    const videoPath = `${basePath}/recording.${compressedVideo.fileExtension}`;
    const videoFile = new File(
      [compressedVideo.blob],
      `recording.${compressedVideo.fileExtension}`,
      { type: compressedVideo.mimeType }
    );

    options.onProgress?.('Uploading video...');
    const videoDownloadUrl = await this.fileUploadService.uploadVideo(videoPath, videoFile);

    options.onProgress?.('Rendering pose overlay...');
    const overlayVideo = await this.createOverlayVideo(
      options.recordedVideo,
      options.analysis,
      options.onProgress
    );
    let overlayVideoPath = '';
    let overlayVideoDownloadUrl = '';
    if (overlayVideo) {
      overlayVideoPath = `${basePath}/overlay.${overlayVideo.fileExtension}`;
      const overlayFile = new File(
        [overlayVideo.blob],
        `overlay.${overlayVideo.fileExtension}`,
        { type: overlayVideo.mimeType }
      );

      options.onProgress?.('Uploading pose overlay...');
      overlayVideoDownloadUrl = await this.fileUploadService.uploadVideo(overlayVideoPath, overlayFile);
    }

    const bodyLandmarksJson = JSON.stringify(options.analysis.bodyLandmarks);
    const jointAnglesJson = JSON.stringify(options.analysis.jointAnglesOverTime);
    const fullAnalysisJson = JSON.stringify(options.analysis);
    const bodyLandmarksPath = `${basePath}/body-landmarks.json`;
    const jointAnglesPath = `${basePath}/joint-angles.json`;
    const fullAnalysisPath = `${basePath}/analysis.json`;

    options.onProgress?.('Uploading analysis data...');
    const [bodyLandmarksUrl, jointAnglesUrl, fullAnalysisUrl] = await Promise.all([
      this.fileUploadService.uploadFile(
        bodyLandmarksPath,
        new File([bodyLandmarksJson], 'body-landmarks.json', { type: 'application/json' })
      ),
      this.fileUploadService.uploadFile(
        jointAnglesPath,
        new File([jointAnglesJson], 'joint-angles.json', { type: 'application/json' })
      ),
      this.fileUploadService.uploadFile(
        fullAnalysisPath,
        new File([fullAnalysisJson], 'analysis.json', { type: 'application/json' })
      ),
    ]);

    options.onProgress?.('Saving trainer record...');
    const analysisRef = doc(
      this.firestore,
      `trainers/${trainerId}/clients/${clientId}/videoAnalysis/${docId}`
    );

    const analysisDocument = this.buildAnalysisDocument(
      options.analysis,
      bodyLandmarksJson,
      jointAnglesJson
    );

    await setDoc(
      analysisRef,
      {
        id: docId,
        clientId,
        trainerId,
        workoutName,
        source: 'camera-page',
        status: 'ready',
        canView: false,
        publishedToClientAt: null,
        publishedToClientBy: null,
        recordedAt: new Date(recordedAtMs).toISOString(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        video: {
          storagePath: videoPath,
          downloadUrl: videoDownloadUrl,
          mimeType: compressedVideo.mimeType,
          compressed: compressedVideo.compressed,
          sizeBytes: compressedVideo.sizeBytes,
          originalSizeBytes: compressedVideo.originalSizeBytes,
          compressionRatio: this.roundNumber(compressedVideo.compressionRatio, 4),
          width: compressedVideo.width,
          height: compressedVideo.height,
          durationMs: options.analysis.durationMs,
        },
        artifacts: {
          overlayVideo: overlayVideo
            ? {
                storagePath: overlayVideoPath,
                downloadUrl: overlayVideoDownloadUrl,
                mimeType: overlayVideo.mimeType,
                sizeBytes: overlayVideo.sizeBytes,
                width: overlayVideo.width,
                height: overlayVideo.height,
              }
            : null,
          bodyLandmarks: {
            storagePath: bodyLandmarksPath,
            downloadUrl: bodyLandmarksUrl,
          },
          jointAngles: {
            storagePath: jointAnglesPath,
            downloadUrl: jointAnglesUrl,
          },
          fullAnalysis: {
            storagePath: fullAnalysisPath,
            downloadUrl: fullAnalysisUrl,
          },
        },
        analysis: analysisDocument,
      },
      { merge: true }
    );

    return {
      documentId: docId,
      videoStoragePath: videoPath,
      videoDownloadUrl,
      overlayVideoStoragePath: overlayVideoPath || undefined,
      overlayVideoDownloadUrl: overlayVideoDownloadUrl || undefined,
      canView: false,
      publishedToClientAt: null,
      publishedToClientBy: null,
    };
  }

  private async ensurePoseLandmarker(): Promise<void> {
    if (this.poseLandmarker) {
      return;
    }

    if (!this.poseLoaderPromise) {
      this.poseLoaderPromise = this.loadPoseLandmarker();
    }

    try {
      await this.poseLoaderPromise;
    } finally {
      this.poseLoaderPromise = null;
    }
  }

  private async loadPoseLandmarker(): Promise<void> {
    const vision = await this.loadVisionBundle();
    const resolver = await vision.FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.mediapipeVersion}/wasm`
    );

    try {
      this.poseLandmarker = await vision.PoseLandmarker.createFromOptions(resolver, {
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
    } catch {
      this.poseLandmarker = await vision.PoseLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    }
  }

  private async loadVisionBundle(): Promise<VisionBundle> {
    return {
      FilesetResolver,
      PoseLandmarker,
    };
  }

  private async waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Unable to read the recorded video.'));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  private async seekVideo(video: HTMLVideoElement, targetSeconds: number): Promise<void> {
    const boundedTarget = Math.max(0, Math.min(targetSeconds, Math.max(video.duration - 0.001, 0)));
    if (Math.abs(video.currentTime - boundedTarget) < 0.001) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Unable to decode a frame from the recorded video.'));
      };
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = boundedTarget;
    });
  }

  private buildSampleTimes(durationMs: number, sampleRateHz: number): number[] {
    if (durationMs <= 0 || sampleRateHz <= 0) {
      return [0];
    }

    const intervalMs = Math.max(1, Math.round(1000 / sampleRateHz));
    const sampleTimes: number[] = [];
    for (let current = 0; current <= durationMs; current += intervalMs) {
      sampleTimes.push(current);
    }
    if (sampleTimes[sampleTimes.length - 1] !== durationMs) {
      sampleTimes.push(durationMs);
    }
    return sampleTimes;
  }

  private pickRelevantLandmarks(landmarks: PoseLandmark[]): Partial<Record<VideoLandmarkName, VideoAnalysisPoint>> {
    const selected: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>> = {};

    for (const [name, index] of Object.entries(LANDMARK_INDEX_MAP) as Array<[VideoLandmarkName, number]>) {
      const point = landmarks[index];
      if (!point) {
        continue;
      }

      selected[name] = {
        x: this.roundNumber(point.x, 4) ?? 0,
        y: this.roundNumber(point.y, 4) ?? 0,
        z: this.roundNumber(point.z ?? null, 4),
        visibility: this.roundNumber(point.visibility ?? null, 4),
      };
    }

    return selected;
  }

  private hasEnoughLandmarks(
    landmarks: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>>
  ): boolean {
    const visibleCount = (Object.values(landmarks) as Array<VideoAnalysisPoint | undefined>).filter(
      (point) => this.isVisiblePoint(point)
    ).length;

    return visibleCount >= 6;
  }

  private computeFrameMetrics(
    landmarks: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>>
  ): FrameMetrics {
    const leftShoulder = this.getVisiblePoint(landmarks.leftShoulder);
    const rightShoulder = this.getVisiblePoint(landmarks.rightShoulder);
    const leftElbow = this.getVisiblePoint(landmarks.leftElbow);
    const rightElbow = this.getVisiblePoint(landmarks.rightElbow);
    const leftWrist = this.getVisiblePoint(landmarks.leftWrist);
    const rightWrist = this.getVisiblePoint(landmarks.rightWrist);
    const leftHip = this.getVisiblePoint(landmarks.leftHip);
    const rightHip = this.getVisiblePoint(landmarks.rightHip);
    const leftKnee = this.getVisiblePoint(landmarks.leftKnee);
    const rightKnee = this.getVisiblePoint(landmarks.rightKnee);
    const leftAnkle = this.getVisiblePoint(landmarks.leftAnkle);
    const rightAnkle = this.getVisiblePoint(landmarks.rightAnkle);

    const shoulderCenter = this.centerPoint(leftShoulder, rightShoulder);
    const hipCenter = this.centerPoint(leftHip, rightHip);
    const kneeCenter = this.centerPoint(leftKnee, rightKnee);

    return {
      leftElbow: this.calculateJointAngle(leftShoulder, leftElbow, leftWrist),
      rightElbow: this.calculateJointAngle(rightShoulder, rightElbow, rightWrist),
      leftShoulder: this.calculateJointAngle(leftHip, leftShoulder, leftElbow),
      rightShoulder: this.calculateJointAngle(rightHip, rightShoulder, rightElbow),
      leftHip: this.calculateJointAngle(leftShoulder, leftHip, leftKnee),
      rightHip: this.calculateJointAngle(rightShoulder, rightHip, rightKnee),
      leftKnee: this.calculateJointAngle(leftHip, leftKnee, leftAnkle),
      rightKnee: this.calculateJointAngle(rightHip, rightKnee, rightAnkle),
      trunkLean: this.calculateTrunkLean(shoulderCenter, hipCenter),
      backAngle: this.calculateJointAngle(shoulderCenter, hipCenter, kneeCenter),
      leftElbowFlare: this.calculateJointAngle(leftElbow, leftShoulder, leftHip),
      rightElbowFlare: this.calculateJointAngle(rightElbow, rightShoulder, rightHip),
      kneeValgusRatio: this.calculateKneeValgusRatio(leftKnee, rightKnee, leftAnkle, rightAnkle),
    };
  }

  private getVisiblePoint(point: VideoAnalysisPoint | undefined): VideoAnalysisPoint | null {
    return this.isVisiblePoint(point) ? point : null;
  }

  private isVisiblePoint(point: VideoAnalysisPoint | undefined): point is VideoAnalysisPoint {
    if (!point) {
      return false;
    }

    const visibility = point.visibility ?? 1;
    return visibility >= 0.4;
  }

  private centerPoint(
    first: VideoAnalysisPoint | null,
    second: VideoAnalysisPoint | null
  ): VideoAnalysisPoint | null {
    if (first && second) {
      return {
        x: this.roundNumber((first.x + second.x) / 2, 4) ?? 0,
        y: this.roundNumber((first.y + second.y) / 2, 4) ?? 0,
        z: this.roundNumber(this.averageValues([first.z, second.z]), 4),
        visibility: this.roundNumber(this.averageValues([first.visibility, second.visibility]), 4),
      };
    }

    return first ?? second ?? null;
  }

  private calculateJointAngle(
    first: VideoAnalysisPoint | null,
    mid: VideoAnalysisPoint | null,
    last: VideoAnalysisPoint | null
  ): number | null {
    if (!first || !mid || !last) {
      return null;
    }

    const a = { x: first.x - mid.x, y: first.y - mid.y };
    const b = { x: last.x - mid.x, y: last.y - mid.y };
    const magnitudeA = Math.hypot(a.x, a.y);
    const magnitudeB = Math.hypot(b.x, b.y);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return null;
    }

    const cosine = ((a.x * b.x) + (a.y * b.y)) / (magnitudeA * magnitudeB);
    const boundedCosine = Math.min(1, Math.max(-1, cosine));
    const angle = (Math.acos(boundedCosine) * 180) / Math.PI;
    return this.roundNumber(angle, 2);
  }

  private calculateTrunkLean(
    shoulderCenter: VideoAnalysisPoint | null,
    hipCenter: VideoAnalysisPoint | null
  ): number | null {
    if (!shoulderCenter || !hipCenter) {
      return null;
    }

    const dx = shoulderCenter.x - hipCenter.x;
    const dy = shoulderCenter.y - hipCenter.y;
    if (dx === 0 && dy === 0) {
      return null;
    }

    const angle = Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
    return this.roundNumber(angle, 2);
  }

  private calculateKneeValgusRatio(
    leftKnee: VideoAnalysisPoint | null,
    rightKnee: VideoAnalysisPoint | null,
    leftAnkle: VideoAnalysisPoint | null,
    rightAnkle: VideoAnalysisPoint | null
  ): number | null {
    if (!leftKnee || !rightKnee || !leftAnkle || !rightAnkle) {
      return null;
    }

    const ankleWidth = Math.abs(leftAnkle.x - rightAnkle.x);
    const kneeWidth = Math.abs(leftKnee.x - rightKnee.x);

    if (ankleWidth <= 0.005) {
      return null;
    }

    return this.roundNumber(kneeWidth / ankleWidth, 4);
  }

  private createJointAngleSeries(): VideoAnalysisResult['jointAnglesOverTime'] {
    return {
      leftElbow: [],
      rightElbow: [],
      leftShoulder: [],
      rightShoulder: [],
      leftHip: [],
      rightHip: [],
      leftKnee: [],
      rightKnee: [],
      trunkLean: [],
      backAngle: [],
    };
  }

  private createSeriesPoint(timeMs: number, value: number | null): VideoAnalysisSeriesPoint {
    return {
      timeMs,
      value: this.roundNumber(value, 2),
    };
  }

  private identifyDominantMovement(
    jointAngles: VideoAnalysisResult['jointAnglesOverTime']
  ): DominantMovementSummary | null {
    const candidates: DominantSignalCandidate[] = [
      this.buildCombinedCandidate(
        'kneeFlexion',
        'Knee flexion',
        jointAngles.leftKnee,
        jointAngles.rightKnee,
        (value) => (value === null ? null : 180 - value)
      ),
      this.buildCombinedCandidate(
        'hipFlexion',
        'Hip flexion',
        jointAngles.leftHip,
        jointAngles.rightHip,
        (value) => (value === null ? null : 180 - value)
      ),
      this.buildCombinedCandidate(
        'elbowFlexion',
        'Elbow flexion',
        jointAngles.leftElbow,
        jointAngles.rightElbow,
        (value) => (value === null ? null : 180 - value)
      ),
      this.buildCombinedCandidate(
        'shoulderTravel',
        'Shoulder angle',
        jointAngles.leftShoulder,
        jointAngles.rightShoulder,
        (value) => value
      ),
      this.buildSingleCandidate('trunkLean', 'Trunk lean', jointAngles.trunkLean),
      this.buildSingleCandidate(
        'backAngle',
        'Back angle',
        this.transformSeries(jointAngles.backAngle, (value) => (value === null ? null : 180 - value))
      ),
    ]
      .filter((candidate) => candidate.series.length > 0)
      .sort((left, right) => right.amplitude - left.amplitude);

    const dominant = candidates[0] ?? null;
    if (!dominant || dominant.amplitude < 8) {
      this.lastBuiltCandidate = null;
      return null;
    }

    this.lastBuiltCandidate = dominant;

    return {
      signal: dominant.signal,
      label: dominant.label,
      amplitude: this.roundNumber(dominant.amplitude, 2) ?? 0,
    };
  }

  private buildRepCountSummary(
    dominantMovement: DominantMovementSummary | null
  ): RepCountSummary {
    if (!dominantMovement) {
      return {
        applicable: false,
        total: 0,
        confidence: 'low',
        dominantSignal: null,
        dominantSignalLabel: null,
        cycles: [],
      };
    }

    const candidate = this.lastBuiltCandidate;
    if (!candidate || candidate.signal !== dominantMovement.signal) {
      return {
        applicable: false,
        total: 0,
        confidence: 'low',
        dominantSignal: dominantMovement.signal,
        dominantSignalLabel: dominantMovement.label,
        cycles: [],
      };
    }

    const cycles = this.detectRepCycles(candidate);
    const averageAmplitude = this.averageValues(cycles.map((cycle) => cycle.amplitude));
    const confidence =
      cycles.length >= 3 && (averageAmplitude ?? 0) >= 18
        ? 'high'
        : cycles.length >= 1 && (averageAmplitude ?? 0) >= 12
          ? 'medium'
          : 'low';

    return {
      applicable: cycles.length > 0,
      total: cycles.length,
      confidence,
      dominantSignal: candidate.signal,
      dominantSignalLabel: candidate.label,
      cycles: cycles.map((cycle) => ({
        ...cycle,
        amplitude: this.roundNumber(cycle.amplitude, 2) ?? 0,
      })),
    };
  }

  private buildTempoSummary(repCount: RepCountSummary): TempoSummary {
    if (!repCount.applicable || repCount.cycles.length === 0) {
      return {
        applicable: false,
        averageRepDurationMs: null,
        averageEccentricMs: null,
        averageConcentricMs: null,
        cadencePerMinute: null,
      };
    }

    const repDurations = repCount.cycles.map((cycle) => cycle.endTimeMs - cycle.startTimeMs);
    const eccentricDurations = repCount.cycles.map((cycle) => cycle.peakTimeMs - cycle.startTimeMs);
    const concentricDurations = repCount.cycles.map((cycle) => cycle.endTimeMs - cycle.peakTimeMs);
    const averageRepDurationMs = this.averageValues(repDurations);

    return {
      applicable: true,
      averageRepDurationMs: this.roundNumber(averageRepDurationMs, 0),
      averageEccentricMs: this.roundNumber(this.averageValues(eccentricDurations), 0),
      averageConcentricMs: this.roundNumber(this.averageValues(concentricDurations), 0),
      cadencePerMinute:
        averageRepDurationMs && averageRepDurationMs > 0
          ? this.roundNumber(60000 / averageRepDurationMs, 1)
          : null,
    };
  }

  private buildRangeOfMotionSummary(
    jointAngles: VideoAnalysisResult['jointAnglesOverTime'],
    dominantMovement: DominantMovementSummary | null
  ): VideoAnalysisResult['rangeOfMotion'] {
    const dominantCandidate = this.lastBuiltCandidate;
    const dominantRange = dominantCandidate
      ? this.buildRangeSummary(dominantCandidate.series)
      : { minimum: null, maximum: null, range: null };

    return {
      dominant: {
        signal: dominantMovement?.signal ?? null,
        label: dominantMovement?.label ?? null,
        minimum: dominantRange.minimum,
        maximum: dominantRange.maximum,
        range: dominantRange.range,
      },
      joints: {
        leftElbow: this.buildRangeSummary(jointAngles.leftElbow),
        rightElbow: this.buildRangeSummary(jointAngles.rightElbow),
        leftShoulder: this.buildRangeSummary(jointAngles.leftShoulder),
        rightShoulder: this.buildRangeSummary(jointAngles.rightShoulder),
        leftHip: this.buildRangeSummary(jointAngles.leftHip),
        rightHip: this.buildRangeSummary(jointAngles.rightHip),
        leftKnee: this.buildRangeSummary(jointAngles.leftKnee),
        rightKnee: this.buildRangeSummary(jointAngles.rightKnee),
      },
    };
  }

  private buildSymmetrySummary(
    jointAngles: VideoAnalysisResult['jointAnglesOverTime']
  ): VideoAnalysisResult['symmetry'] {
    const knees = this.buildPairSymmetrySummary(jointAngles.leftKnee, jointAngles.rightKnee);
    const hips = this.buildPairSymmetrySummary(jointAngles.leftHip, jointAngles.rightHip);
    const elbows = this.buildPairSymmetrySummary(jointAngles.leftElbow, jointAngles.rightElbow);
    const shoulders = this.buildPairSymmetrySummary(jointAngles.leftShoulder, jointAngles.rightShoulder);

    return {
      overallScore: this.roundNumber(
        this.averageValues([knees.score, hips.score, elbows.score, shoulders.score]),
        1
      ),
      knees,
      hips,
      elbows,
      shoulders,
    };
  }

  private buildTrunkLeanSummary(series: VideoAnalysisSeriesPoint[]): TrunkLeanSummary {
    const range = this.buildRangeSummary(series);
    return {
      applicable: range.range !== null,
      average: this.roundNumber(this.averageValues(series.map((point) => point.value)), 2),
      maximum: range.maximum,
      series,
    };
  }

  private buildBackAngleSummary(series: VideoAnalysisSeriesPoint[]): BackAngleSummary {
    const range = this.buildRangeSummary(series);
    return {
      applicable: range.range !== null,
      average: this.roundNumber(this.averageValues(series.map((point) => point.value)), 2),
      minimum: range.minimum,
      maximum: range.maximum,
      series,
    };
  }

  private buildKneeValgusSummary(series: VideoAnalysisSeriesPoint[]): KneeValgusSummary {
    const values = series
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const framesFlagged = values.filter((value) => value < 0.85).length;

    return {
      applicable: values.length > 0,
      averageRatio: this.roundNumber(this.averageValues(values), 3),
      minimumRatio: this.roundNumber(this.minimumValue(values), 3),
      framesFlagged,
      flaggedFramePercentage:
        values.length > 0 ? this.roundNumber((framesFlagged / values.length) * 100, 1) : null,
      series,
    };
  }

  private buildElbowFlareSummary(
    leftSeries: VideoAnalysisSeriesPoint[],
    rightSeries: VideoAnalysisSeriesPoint[]
  ): ElbowFlareSummary {
    const leftValues = leftSeries
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const rightValues = rightSeries
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return {
      applicable: leftValues.length > 0 || rightValues.length > 0,
      leftAverage: this.roundNumber(this.averageValues(leftValues), 2),
      rightAverage: this.roundNumber(this.averageValues(rightValues), 2),
      leftMaximum: this.roundNumber(this.maximumValue(leftValues), 2),
      rightMaximum: this.roundNumber(this.maximumValue(rightValues), 2),
      leftSeries,
      rightSeries,
    };
  }

  private buildCombinedCandidate(
    signal: string,
    label: string,
    leftSeries: VideoAnalysisSeriesPoint[],
    rightSeries: VideoAnalysisSeriesPoint[],
    transform: (value: number | null) => number | null
  ): DominantSignalCandidate {
    const merged: VideoAnalysisSeriesPoint[] = [];
    const length = Math.max(leftSeries.length, rightSeries.length);

    for (let index = 0; index < length; index += 1) {
      const leftPoint = leftSeries[index];
      const rightPoint = rightSeries[index];
      const timeMs = leftPoint?.timeMs ?? rightPoint?.timeMs ?? 0;
      const transformedValues = [
        transform(leftPoint?.value ?? null),
        transform(rightPoint?.value ?? null),
      ];

      merged.push({
        timeMs,
        value: this.roundNumber(this.averageValues(transformedValues), 2),
      });
    }

    return this.buildSingleCandidate(signal, label, merged);
  }

  private buildSingleCandidate(
    signal: string,
    label: string,
    series: VideoAnalysisSeriesPoint[]
  ): DominantSignalCandidate {
    const smoothed = this.smoothSeries(series, 5);
    const amplitude = this.computeAmplitude(smoothed);

    return {
      signal,
      label,
      series: smoothed,
      amplitude,
    };
  }

  private transformSeries(
    series: VideoAnalysisSeriesPoint[],
    transform: (value: number | null) => number | null
  ): VideoAnalysisSeriesPoint[] {
    return series.map((point) => ({
      timeMs: point.timeMs,
      value: this.roundNumber(transform(point.value), 2),
    }));
  }

  private smoothSeries(
    series: VideoAnalysisSeriesPoint[],
    windowSize: number
  ): VideoAnalysisSeriesPoint[] {
    if (series.length === 0) {
      return [];
    }

    const radius = Math.max(1, Math.floor(windowSize / 2));
    return series.map((point, index) => {
      const values: Array<number | null> = [];
      for (let offset = -radius; offset <= radius; offset += 1) {
        values.push(series[index + offset]?.value ?? null);
      }

      return {
        timeMs: point.timeMs,
        value: this.roundNumber(this.averageValues(values), 2),
      };
    });
  }

  private computeAmplitude(series: VideoAnalysisSeriesPoint[]): number {
    const values = series
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .sort((left, right) => left - right);

    if (values.length < 3) {
      return 0;
    }

    const p10 = this.percentile(values, 0.1);
    const p90 = this.percentile(values, 0.9);
    return this.roundNumber(p90 - p10, 2) ?? 0;
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) {
      return 0;
    }

    const index = Math.min(values.length - 1, Math.max(0, (values.length - 1) * percentile));
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) {
      return values[lower];
    }

    const remainder = index - lower;
    return values[lower] + ((values[upper] - values[lower]) * remainder);
  }

  private buildPairSymmetrySummary(
    leftSeries: VideoAnalysisSeriesPoint[],
    rightSeries: VideoAnalysisSeriesPoint[]
  ): SymmetryPairSummary {
    const leftRange = this.buildRangeSummary(leftSeries).range;
    const rightRange = this.buildRangeSummary(rightSeries).range;
    const pairedDifferences: number[] = [];

    const length = Math.max(leftSeries.length, rightSeries.length);
    for (let index = 0; index < length; index += 1) {
      const leftValue = leftSeries[index]?.value ?? null;
      const rightValue = rightSeries[index]?.value ?? null;
      if (leftValue === null || rightValue === null) {
        continue;
      }
      pairedDifferences.push(Math.abs(leftValue - rightValue));
    }

    const averageDifference = this.averageValues(pairedDifferences);
    const maxRange = Math.max(leftRange ?? 0, rightRange ?? 0);
    const rangeDifferencePercent =
      maxRange > 0
        ? this.roundNumber((Math.abs((leftRange ?? 0) - (rightRange ?? 0)) / maxRange) * 100, 1)
        : null;

    const diffScore =
      averageDifference !== null ? Math.max(0, 100 - (averageDifference * 2.25)) : null;
    const rangeScore =
      rangeDifferencePercent !== null ? Math.max(0, 100 - rangeDifferencePercent) : null;

    return {
      applicable:
        (leftRange !== null && rightRange !== null) || pairedDifferences.length > 0,
      leftRange,
      rightRange,
      averageDifference: this.roundNumber(averageDifference, 2),
      rangeDifferencePercent,
      score: this.roundNumber(this.averageValues([diffScore, rangeScore]), 1),
    };
  }

  private buildRangeSummary(series: VideoAnalysisSeriesPoint[]): JointRangeSummary {
    const values = series
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (values.length === 0) {
      return {
        minimum: null,
        maximum: null,
        range: null,
      };
    }

    const minimum = this.minimumValue(values);
    const maximum = this.maximumValue(values);

    return {
      minimum: this.roundNumber(minimum, 2),
      maximum: this.roundNumber(maximum, 2),
      range:
        minimum !== null && maximum !== null
          ? this.roundNumber(maximum - minimum, 2)
          : null,
    };
  }

  private detectRepCycles(candidate: DominantSignalCandidate): RepCountSummary['cycles'] {
    const numericSeries = candidate.series
      .filter((point): point is NumericSeriesPoint => point.value !== null)
      .map((point) => ({ timeMs: point.timeMs, value: point.value }));

    if (numericSeries.length < 5 || candidate.amplitude < 8) {
      return [];
    }

    const extrema = this.filterExtremaBySeparation(this.detectExtrema(numericSeries), 250);
    const minimumAmplitude = Math.max(8, candidate.amplitude * 0.35);
    const minimumDurationMs = 700;
    const cycles: RepCountSummary['cycles'] = [];
    let start: ExtremaPoint | null = null;
    let peak: ExtremaPoint | null = null;

    for (const point of extrema) {
      if (point.type === 'min') {
        if (!start) {
          start = point;
          continue;
        }

        if (peak) {
          const amplitude = peak.value - Math.max(start.value, point.value);
          const duration = point.timeMs - start.timeMs;

          if (amplitude >= minimumAmplitude && duration >= minimumDurationMs) {
            cycles.push({
              startTimeMs: start.timeMs,
              peakTimeMs: peak.timeMs,
              endTimeMs: point.timeMs,
              amplitude,
            });
          }
        }

        start = point;
        peak = null;
        continue;
      }

      if (!start) {
        continue;
      }

      const amplitudeFromStart = point.value - start.value;
      if (amplitudeFromStart < minimumAmplitude * 0.6) {
        continue;
      }

      if (!peak || point.value > peak.value) {
        peak = point;
      }
    }

    return cycles;
  }

  private detectExtrema(series: NumericSeriesPoint[]): ExtremaPoint[] {
    if (series.length < 3) {
      return [];
    }

    const extrema: ExtremaPoint[] = [];
    for (let index = 1; index < series.length - 1; index += 1) {
      const previous = series[index - 1];
      const current = series[index];
      const next = series[index + 1];

      if (current.value >= previous.value && current.value > next.value) {
        extrema.push({ ...current, type: 'max' });
      } else if (current.value <= previous.value && current.value < next.value) {
        extrema.push({ ...current, type: 'min' });
      }
    }

    return extrema;
  }

  private filterExtremaBySeparation(extrema: ExtremaPoint[], minimumGapMs: number): ExtremaPoint[] {
    if (extrema.length === 0) {
      return [];
    }

    const filtered: ExtremaPoint[] = [];
    for (const point of extrema) {
      const lastPoint = filtered[filtered.length - 1];
      if (!lastPoint) {
        filtered.push(point);
        continue;
      }

      if (point.type !== lastPoint.type || point.timeMs - lastPoint.timeMs >= minimumGapMs) {
        filtered.push(point);
        continue;
      }

      const shouldReplace =
        point.type === 'max' ? point.value > lastPoint.value : point.value < lastPoint.value;
      if (shouldReplace) {
        filtered[filtered.length - 1] = point;
      }
    }

    return filtered;
  }

  private buildAnalysisDocument(
    analysis: VideoAnalysisResult,
    bodyLandmarksJson: string,
    jointAnglesJson: string
  ): Record<string, unknown> {
    const includeBodyLandmarksInline =
      new Blob([bodyLandmarksJson]).size <= this.inlineLandmarksLimitBytes;
    const includeJointAnglesInline =
      new Blob([jointAnglesJson]).size <= this.inlineJointAnglesLimitBytes;

    return {
      analyzedAtIso: analysis.analyzedAtIso,
      durationMs: analysis.durationMs,
      sampleRateHz: analysis.sampleRateHz,
      framesRequested: analysis.framesRequested,
      framesAnalyzed: analysis.framesAnalyzed,
      dominantMovement: analysis.dominantMovement,
      repCount: analysis.repCount,
      tempo: analysis.tempo,
      rangeOfMotion: analysis.rangeOfMotion,
      symmetry: analysis.symmetry,
      posture: analysis.posture,
      jointAnglesStoredInline: includeJointAnglesInline,
      bodyLandmarksStoredInline: includeBodyLandmarksInline,
      jointAnglesOverTime: includeJointAnglesInline ? analysis.jointAnglesOverTime : null,
      bodyLandmarks: includeBodyLandmarksInline ? analysis.bodyLandmarks : null,
    };
  }

  private async compressVideo(recordedVideo: Blob): Promise<VideoCompressionResult> {
    if (
      typeof document === 'undefined' ||
      typeof MediaRecorder === 'undefined' ||
      typeof HTMLCanvasElement === 'undefined'
    ) {
      return this.originalCompressionResult(recordedVideo, 0, 0);
    }

    const compressionVideo = document.createElement('video');
    compressionVideo.preload = 'auto';
    compressionVideo.muted = true;
    compressionVideo.playsInline = true;

    const objectUrl = URL.createObjectURL(recordedVideo);
    try {
      compressionVideo.src = objectUrl;
      compressionVideo.load();
      await this.waitForVideoMetadata(compressionVideo);

      const width = compressionVideo.videoWidth || 0;
      const height = compressionVideo.videoHeight || 0;
      const targetDimensions = this.calculateTargetDimensions(width, height);
      const mimeType = this.resolveCompressionMimeType();
      const canvas = document.createElement('canvas');
      canvas.width = targetDimensions.width;
      canvas.height = targetDimensions.height;

      const context = canvas.getContext('2d');
      const captureStream = (canvas as HTMLCanvasElement & {
        captureStream?: (frameRate?: number) => MediaStream;
      }).captureStream;

      if (!context || typeof captureStream !== 'function' || !mimeType) {
        return this.originalCompressionResult(recordedVideo, width, height);
      }

      const renderStream = captureStream.call(canvas, 24);
      const mediaRecorder = new MediaRecorder(renderStream, {
        mimeType,
        videoBitsPerSecond: this.resolveTargetBitrate(targetDimensions.width, targetDimensions.height),
      });
      const chunks: BlobPart[] = [];
      let drawFrameId: number | null = null;

      const recorderStopPromise = new Promise<void>((resolve, reject) => {
        mediaRecorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        });
        mediaRecorder.addEventListener('stop', () => resolve(), { once: true });
        mediaRecorder.addEventListener(
          'error',
          () => reject(new Error('Unable to compress the recorded video.')),
          { once: true }
        );
      });

      const drawLoop = () => {
        if (!compressionVideo.paused && !compressionVideo.ended) {
          context.drawImage(compressionVideo, 0, 0, canvas.width, canvas.height);
          drawFrameId = requestAnimationFrame(drawLoop);
        }
      };

      mediaRecorder.start(250);
      await compressionVideo.play();
      drawLoop();

      await new Promise<void>((resolve, reject) => {
        const onEnded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Unable to play the recorded video for compression.'));
        };
        const cleanup = () => {
          compressionVideo.removeEventListener('ended', onEnded);
          compressionVideo.removeEventListener('error', onError);
        };

        compressionVideo.addEventListener('ended', onEnded, { once: true });
        compressionVideo.addEventListener('error', onError, { once: true });
      });

      context.drawImage(compressionVideo, 0, 0, canvas.width, canvas.height);
      if (drawFrameId !== null) {
        cancelAnimationFrame(drawFrameId);
      }
      mediaRecorder.stop();
      await recorderStopPromise;
      renderStream.getTracks().forEach((track) => track.stop());

      const compressedBlob = new Blob(chunks, { type: mimeType });
      if (compressedBlob.size === 0 || compressedBlob.size >= recordedVideo.size * 0.98) {
        return this.originalCompressionResult(recordedVideo, width, height);
      }

      return {
        blob: compressedBlob,
        mimeType,
        fileExtension: this.mimeTypeToExtension(mimeType),
        sizeBytes: compressedBlob.size,
        originalSizeBytes: recordedVideo.size,
        compressed: true,
        compressionRatio: compressedBlob.size / Math.max(1, recordedVideo.size),
        width: targetDimensions.width,
        height: targetDimensions.height,
      };
    } catch {
      return this.originalCompressionResult(recordedVideo, 0, 0);
    } finally {
      URL.revokeObjectURL(objectUrl);
      compressionVideo.pause();
      compressionVideo.removeAttribute('src');
      compressionVideo.load();
    }
  }

  private async createOverlayVideo(
    recordedVideo: Blob,
    analysis: VideoAnalysisResult,
    onProgress?: ProgressCallback
  ): Promise<VideoCompressionResult | null> {
    if (
      typeof document === 'undefined' ||
      typeof MediaRecorder === 'undefined' ||
      typeof HTMLCanvasElement === 'undefined' ||
      analysis.bodyLandmarks.length === 0
    ) {
      return null;
    }

    const overlayVideo = document.createElement('video');
    overlayVideo.preload = 'auto';
    overlayVideo.muted = true;
    overlayVideo.playsInline = true;

    const objectUrl = URL.createObjectURL(recordedVideo);
    try {
      overlayVideo.src = objectUrl;
      overlayVideo.load();
      await this.waitForVideoMetadata(overlayVideo);

      const width = overlayVideo.videoWidth || 0;
      const height = overlayVideo.videoHeight || 0;
      const targetDimensions = this.calculateTargetDimensions(width, height);
      const mimeType = this.resolveCompressionMimeType();
      const canvas = document.createElement('canvas');
      canvas.width = targetDimensions.width;
      canvas.height = targetDimensions.height;

      const context = canvas.getContext('2d');
      const captureStream = (canvas as HTMLCanvasElement & {
        captureStream?: (frameRate?: number) => MediaStream;
      }).captureStream;

      if (!context || typeof captureStream !== 'function' || !mimeType) {
        return null;
      }

      const renderStream = captureStream.call(canvas, 24);
      const mediaRecorder = new MediaRecorder(renderStream, {
        mimeType,
        videoBitsPerSecond: Math.max(
          900_000,
          Math.round(this.resolveTargetBitrate(targetDimensions.width, targetDimensions.height) * 0.75)
        ),
      });
      const chunks: BlobPart[] = [];
      let drawFrameId: number | null = null;
      let lastProgressBucket = -1;

      const recorderStopPromise = new Promise<void>((resolve, reject) => {
        mediaRecorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        });
        mediaRecorder.addEventListener('stop', () => resolve(), { once: true });
        mediaRecorder.addEventListener(
          'error',
          () => reject(new Error('Unable to render the pose overlay video.')),
          { once: true }
        );
      });

      const drawOverlayFrame = () => {
        if (overlayVideo.paused && !overlayVideo.ended) {
          return;
        }

        context.drawImage(overlayVideo, 0, 0, canvas.width, canvas.height);

        const currentTimeMs = overlayVideo.currentTime * 1000;
        const progressBucket = Math.floor(currentTimeMs / 2000);
        if (progressBucket !== lastProgressBucket) {
          lastProgressBucket = progressBucket;
          onProgress?.('Rendering pose overlay...');
        }

        const landmarks = this.interpolateLandmarks(analysis.bodyLandmarks, currentTimeMs);
        this.drawPoseOverlay(context, canvas.width, canvas.height, landmarks);

        if (!overlayVideo.ended) {
          drawFrameId = requestAnimationFrame(drawOverlayFrame);
        }
      };

      mediaRecorder.start(250);
      await overlayVideo.play();
      drawOverlayFrame();

      await new Promise<void>((resolve, reject) => {
        const onEnded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Unable to play the recorded video for overlay rendering.'));
        };
        const cleanup = () => {
          overlayVideo.removeEventListener('ended', onEnded);
          overlayVideo.removeEventListener('error', onError);
        };

        overlayVideo.addEventListener('ended', onEnded, { once: true });
        overlayVideo.addEventListener('error', onError, { once: true });
      });

      context.drawImage(overlayVideo, 0, 0, canvas.width, canvas.height);
      this.drawPoseOverlay(
        context,
        canvas.width,
        canvas.height,
        this.interpolateLandmarks(analysis.bodyLandmarks, analysis.durationMs)
      );

      if (drawFrameId !== null) {
        cancelAnimationFrame(drawFrameId);
      }
      mediaRecorder.stop();
      await recorderStopPromise;
      renderStream.getTracks().forEach((track) => track.stop());

      const renderedBlob = new Blob(chunks, { type: mimeType });
      if (renderedBlob.size === 0) {
        return null;
      }

      return {
        blob: renderedBlob,
        mimeType,
        fileExtension: this.mimeTypeToExtension(mimeType),
        sizeBytes: renderedBlob.size,
        originalSizeBytes: recordedVideo.size,
        compressed: true,
        compressionRatio: renderedBlob.size / Math.max(1, recordedVideo.size),
        width: targetDimensions.width,
        height: targetDimensions.height,
      };
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
      overlayVideo.pause();
      overlayVideo.removeAttribute('src');
      overlayVideo.load();
    }
  }

  private interpolateLandmarks(
    frames: VideoAnalysisFrame[],
    timeMs: number
  ): Partial<Record<VideoLandmarkName, VideoAnalysisPoint>> {
    if (frames.length === 0) {
      return {};
    }

    if (timeMs <= frames[0].timeMs) {
      return frames[0].landmarks;
    }

    const lastFrame = frames[frames.length - 1];
    if (timeMs >= lastFrame.timeMs) {
      return lastFrame.landmarks;
    }

    let previous = frames[0];
    let next = frames[frames.length - 1];
    for (let index = 1; index < frames.length; index += 1) {
      const current = frames[index];
      if (current.timeMs >= timeMs) {
        next = current;
        previous = frames[index - 1];
        break;
      }
    }

    const duration = Math.max(1, next.timeMs - previous.timeMs);
    const ratio = Math.min(1, Math.max(0, (timeMs - previous.timeMs) / duration));
    const interpolated: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>> = {};

    for (const landmarkName of Object.keys(LANDMARK_INDEX_MAP) as VideoLandmarkName[]) {
      const previousPoint = previous.landmarks[landmarkName];
      const nextPoint = next.landmarks[landmarkName];

      if (previousPoint && nextPoint) {
        interpolated[landmarkName] = {
          x: this.roundNumber(
            previousPoint.x + ((nextPoint.x - previousPoint.x) * ratio),
            4
          ) ?? previousPoint.x,
          y: this.roundNumber(
            previousPoint.y + ((nextPoint.y - previousPoint.y) * ratio),
            4
          ) ?? previousPoint.y,
          z: this.roundNumber(
            this.interpolateNullableValue(previousPoint.z, nextPoint.z, ratio),
            4
          ),
          visibility: this.roundNumber(
            this.interpolateNullableValue(previousPoint.visibility, nextPoint.visibility, ratio),
            4
          ),
        };
        continue;
      }

      const fallbackPoint = previousPoint ?? nextPoint;
      if (fallbackPoint) {
        interpolated[landmarkName] = fallbackPoint;
      }
    }

    return interpolated;
  }

  private interpolateNullableValue(
    start: number | null,
    end: number | null,
    ratio: number
  ): number | null {
    if (start === null && end === null) {
      return null;
    }

    if (start === null) {
      return end;
    }

    if (end === null) {
      return start;
    }

    return start + ((end - start) * ratio);
  }

  private drawPoseOverlay(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    landmarks: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>>
  ): void {
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(27, 232, 183, 0.96)';
    context.fillStyle = 'rgba(27, 232, 183, 0.96)';
    context.shadowBlur = 10;
    context.shadowColor = 'rgba(27, 232, 183, 0.45)';
    context.lineWidth = Math.max(2, Math.round(width * 0.0045));

    for (const [startName, endName] of OVERLAY_CONNECTIONS) {
      const startPoint = landmarks[startName];
      const endPoint = landmarks[endName];
      if (!this.isVisiblePoint(startPoint) || !this.isVisiblePoint(endPoint)) {
        continue;
      }

      context.beginPath();
      context.moveTo(startPoint.x * width, startPoint.y * height);
      context.lineTo(endPoint.x * width, endPoint.y * height);
      context.stroke();
    }

    for (const point of Object.values(landmarks)) {
      if (!this.isVisiblePoint(point)) {
        continue;
      }

      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(4, width * 0.008), 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }

  private originalCompressionResult(
    recordedVideo: Blob,
    width: number,
    height: number
  ): VideoCompressionResult {
    const mimeType = recordedVideo.type || 'video/webm';
    return {
      blob: recordedVideo,
      mimeType,
      fileExtension: this.mimeTypeToExtension(mimeType),
      sizeBytes: recordedVideo.size,
      originalSizeBytes: recordedVideo.size,
      compressed: false,
      compressionRatio: 1,
      width,
      height,
    };
  }

  private calculateTargetDimensions(width: number, height: number): { width: number; height: number } {
    if (width <= 0 || height <= 0) {
      return { width: 720, height: 960 };
    }

    const maxLongEdge = 1280;
    const maxShortEdge = 720;
    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);
    const scale = Math.min(1, maxLongEdge / longEdge, maxShortEdge / shortEdge);

    return {
      width: this.toEvenNumber(Math.max(2, Math.round(width * scale))),
      height: this.toEvenNumber(Math.max(2, Math.round(height * scale))),
    };
  }

  private resolveTargetBitrate(width: number, height: number): number {
    const estimated = Math.round(width * height * 2.2);
    return Math.min(2_500_000, Math.max(1_200_000, estimated));
  }

  private resolveCompressionMimeType(): string {
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

  private mimeTypeToExtension(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('mp4')) {
      return 'mp4';
    }
    if (normalized.includes('quicktime')) {
      return 'mov';
    }
    return 'webm';
  }

  private toEvenNumber(value: number): number {
    return value % 2 === 0 ? value : value - 1;
  }

  private averageValues(values: Array<number | null | undefined>): number | null {
    const numericValues = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );

    if (numericValues.length === 0) {
      return null;
    }

    const total = numericValues.reduce((sum, value) => sum + value, 0);
    return total / numericValues.length;
  }

  private maximumValue(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }
    return Math.max(...values);
  }

  private minimumValue(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }
    return Math.min(...values);
  }

  private roundNumber(value: number | null, digits: number): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }

    return Number(value.toFixed(digits));
  }

  private lastBuiltCandidate: DominantSignalCandidate | null = null;
}
