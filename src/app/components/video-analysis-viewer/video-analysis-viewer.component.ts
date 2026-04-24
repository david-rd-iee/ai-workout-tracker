import { CommonModule } from '@angular/common';
import { AlertController, IonIcon } from '@ionic/angular/standalone';
import {
  AfterViewChecked,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  Component,
  inject,
} from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, setDoc } from 'firebase/firestore';
import { FileUploadService } from '../../services/file-upload.service';
import { VideoPlaybackCacheService } from '../../services/video-playback-cache.service';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  buildOutline,
  imageOutline,
  pauseOutline,
  playOutline,
} from 'ionicons/icons';
import {
  VideoAnalysisViewerAnalysis,
  VideoAnalysisViewerDrawing,
  VideoAnalysisViewerNote,
  normalizePoseFrames,
} from './video-analysis-viewer.types';
import {
  POSE_CONNECTIONS,
  VideoAnalysisFrame,
  VideoAnalysisPoint,
  VideoLandmarkName,
} from '../../models/video-analysis.model';

// ─── Module-level constants ───────────────────────────────────────────────────

type CanvasPoint = { x: number; y: number };

type AngleMeasurementResult = {
  jointName: VideoLandmarkName;
  vertex: CanvasPoint;
  firstEnd: CanvasPoint;
  secondEnd: CanvasPoint;
  angleDegrees: number;
};

type WorkoutAnalysisEvent =
  | {
      kind: 'note';
      id: string;
      timestampSeconds: number;
      note: string;
      createdAtIso: string;
    }
  | {
      kind: 'drawing';
      id: string;
      timestampSeconds: number;
      imageUrl: string;
      note: string;
      createdAtIso: string;
    };

type VideoMode = 'recording' | 'overlay';

/**
 * Maps each measurable joint to the pair of connected landmarks that define its
 * anatomically meaningful angle. Joints not listed here (nose, wrists, ankles)
 * are not measurable because they have only one connection in the skeleton graph.
 */
const JOINT_ANGLE_MEASUREMENT_PAIRS: Partial<Record<VideoLandmarkName, [VideoLandmarkName, VideoLandmarkName]>> = {
  leftElbow: ['leftShoulder', 'leftWrist'],
  rightElbow: ['rightShoulder', 'rightWrist'],
  leftShoulder: ['leftHip', 'leftElbow'],
  rightShoulder: ['rightHip', 'rightElbow'],
  leftHip: ['leftShoulder', 'leftKnee'],
  rightHip: ['rightShoulder', 'rightKnee'],
  leftKnee: ['leftHip', 'leftAnkle'],
  rightKnee: ['rightHip', 'rightAnkle'],
};

const LANDMARK_VISIBILITY_THRESHOLD = 0.4;

// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-video-analysis-viewer',
  standalone: true,
  templateUrl: './video-analysis-viewer.component.html',
  styleUrls: ['./video-analysis-viewer.component.scss'],
  imports: [
    CommonModule,
    IonIcon,
  ],
})
export class VideoAnalysisViewerComponent implements OnChanges, AfterViewChecked {
  @Input() analysis: VideoAnalysisViewerAnalysis | null = null;
  @Input() clientId = '';
  @Input() trainerId = '';
  @Input() readonly = false;
  @Input() showTools = true;
  @Input() showSendToClient = false;
  @Input() sendToClientLabel = 'Send to Client';
  @Input() disableSendToClient = false;

  @Output() analysisChange = new EventEmitter<VideoAnalysisViewerAnalysis>();
  @Output() requestSendToClient = new EventEmitter<void>();

  @ViewChild('playerShell') private playerShellRef?: ElementRef<HTMLDivElement>;
  @ViewChild('playerFrame') private playerFrameRef?: ElementRef<HTMLDivElement>;
  @ViewChild('recordingVideo') private recordingVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayVideo') private overlayVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('drawingCanvas') private drawingCanvasRef?: ElementRef<HTMLCanvasElement>;

  private readonly firestore = inject(Firestore);
  private readonly alertCtrl = inject(AlertController);
  private readonly fileUploadService = inject(FileUploadService);
  private readonly videoPlaybackCacheService = inject(VideoPlaybackCacheService);

  analysisState: VideoAnalysisViewerAnalysis | null = null;
  videoMode: VideoMode = 'recording';
  recordingPlaybackUrl = '';
  overlayPlaybackUrl = '';
  playbackErrorMessage = '';
  isSwitchingVideo = false;
  isPlaying = false;
  currentTimeSeconds = 0;
  durationSeconds = 0;
  toolsOpen = false;
  eventsOpen = false;
  isDrawingMode = false;
  isSavingDrawing = false;
  selectedDrawingImageUrl = '';
  hasDrawingInk = false;
  drawingTimestampSeconds = 0;
  drawMode: 'freehand' | 'line' = 'freehand';
  activeCanvasTool: 'draw' | 'measure' | null = null;
  measureInstruction = '';
  hasMeasuredAngle = false;
  inlineNoteOpen = false;
  inlineNoteText = '';
  inlineNoteTimestampSeconds = 0;
  portraitPlayerFrameHeightPx: number | null = null;

  private pendingVideoSelectionSync = false;
  private drawing = false;
  private lastAnalysisId = '';
  private lastDrawPoint: CanvasPoint | null = null;
  private lineStartPoint: CanvasPoint | null = null;
  private lineSnapshot: ImageData | null = null;
  private measurementBaseImageData: ImageData | null = null;
  private measureResults: AngleMeasurementResult[] = [];
  private measureSelectionPath: CanvasPoint[] = [];
  private activePoseFrame: VideoAnalysisFrame | null = null;
  private readonly portraitPlayerGutterPx = 84;
  private recordingFallbackUrl = '';
  private overlayFallbackUrl = '';
  private recordingCrossOriginEnabled = true;
  private overlayCrossOriginEnabled = true;
  private pendingSwitchResumeSeconds: number | null = null;
  private pendingSwitchAutoplay = false;
  private readonly supportProbeVideo = document.createElement('video');
  private readonly isIPhoneDevice = /iPhone/i.test(navigator.userAgent || '');
  private readonly canvasSafePrefetchMaxBytes = 65 * 1024 * 1024;
  private readonly canvasSafePrefetchTimeoutMs = 45_000;

  constructor() {
    addIcons({
      arrowBackOutline,
      buildOutline,
      imageOutline,
      playOutline,
      pauseOutline,
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ('readonly' in changes) {
      this.resetCrossOriginPolicy();
    }

    if ('analysis' in changes) {
      const nextAnalysis = this.analysis;
      const nextId = nextAnalysis?.id || '';
      if (nextId && nextId !== this.lastAnalysisId) {
        this.lastAnalysisId = nextId;
        this.selectAnalysis(nextAnalysis);
      } else if (!nextId) {
        this.lastAnalysisId = '';
        this.analysisState = null;
        this.configurePlaybackSources();
      } else if (nextAnalysis) {
        this.analysisState = {
          ...nextAnalysis,
          notes: [...nextAnalysis.notes],
          drawings: [...nextAnalysis.drawings],
        };
        this.configurePlaybackSources();
        this.videoMode = this.resolvePreferredVideoMode(this.videoMode);
      }
    }
  }

  ngAfterViewChecked(): void {
    if (!this.pendingVideoSelectionSync) {
      return;
    }

    this.pendingVideoSelectionSync = false;
    void this.initializeSelectedVideoState();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.schedulePortraitFrameHeightSync();
  }

  get activeAnalysisLabel(): string {
    return this.analysisState?.label || '';
  }

  get activeAnalysisDisplayDate(): string {
    return this.formatAnalysisDate(this.analysisState?.analyzedAtIso || '');
  }

  get activeAnalysisDisplayTitle(): string {
    return this.analysisState?.workoutName || '';
  }

  get canToggleOverlay(): boolean {
    return !!this.overlayPlaybackUrl;
  }

  get isRecordingMode(): boolean {
    return this.videoMode === 'recording';
  }

  get recordingVideoCrossOriginValue(): string | null {
    return this.recordingCrossOriginEnabled ? 'anonymous' : null;
  }

  get overlayVideoCrossOriginValue(): string | null {
    return this.overlayCrossOriginEnabled ? 'anonymous' : null;
  }

  get hasEvents(): boolean {
    return this.timelineEvents.length > 0;
  }

  get isLandscapeMode(): boolean {
    return !this.isPortraitViewport();
  }

  get showVideoModeToggle(): boolean {
    return !(this.isDrawingMode && this.activeCanvasTool === 'measure');
  }

  get shouldLazyLoadInactiveVideo(): boolean {
    // Keep both sources loaded to make recording/overlay switching instant and
    // maintain identical timestamps across modes.
    return false;
  }

  get progressPercent(): number {
    if (!this.durationSeconds || !Number.isFinite(this.durationSeconds)) {
      return 0;
    }

    return Math.max(0, Math.min((this.currentTimeSeconds / this.durationSeconds) * 100, 100));
  }

  get timelineEvents(): WorkoutAnalysisEvent[] {
    const analysis = this.analysisState;
    if (!analysis) {
      return [];
    }

    const noteEvents: WorkoutAnalysisEvent[] = analysis.notes.map((note, index) => ({
      kind: 'note',
      id: `note-${note.createdAtIso || index}-${note.timestampSeconds}`,
      timestampSeconds: note.timestampSeconds,
      note: note.note,
      createdAtIso: note.createdAtIso,
    }));

    const drawingEvents: WorkoutAnalysisEvent[] = analysis.drawings.map((drawing, index) => ({
      kind: 'drawing',
      id: `drawing-${drawing.createdAtIso || index}-${drawing.timestampSeconds}`,
      timestampSeconds: drawing.timestampSeconds,
      imageUrl: drawing.imageUrl,
      note: drawing.note,
      createdAtIso: drawing.createdAtIso,
    }));

    return [...noteEvents, ...drawingEvents].sort((left, right) => {
      if (left.timestampSeconds !== right.timestampSeconds) {
        return left.timestampSeconds - right.timestampSeconds;
      }

      return left.createdAtIso.localeCompare(right.createdAtIso);
    });
  }

  selectAnalysis(analysis: VideoAnalysisViewerAnalysis | null): void {
    this.analysisState = analysis
      ? {
          ...analysis,
          notes: [...analysis.notes],
          drawings: [...analysis.drawings],
        }
      : null;
    this.configurePlaybackSources();
    this.resetCrossOriginPolicy();
    this.videoMode = this.resolvePreferredVideoMode('recording');
    this.playbackErrorMessage = '';
    this.isPlaying = false;
    this.currentTimeSeconds = 0;
    this.durationSeconds = 0;
    this.toolsOpen = false;
    this.eventsOpen = false;
    this.isDrawingMode = false;
    this.selectedDrawingImageUrl = '';
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = 0;
    this.drawMode = 'freehand';
    this.activeCanvasTool = null;
    this.measureInstruction = '';
    this.hasMeasuredAngle = false;
    this.measureResults = [];
    this.measureSelectionPath = [];
    this.measurementBaseImageData = null;
    this.activePoseFrame = null;
    this.pendingVideoSelectionSync = !!analysis;
  }

  toggleTools(): void {
    if (this.isDrawingMode || this.readonly || !this.showTools) {
      return;
    }

    this.toolsOpen = !this.toolsOpen;
  }

  openEvents(): void {
    if (!this.hasEvents) {
      return;
    }

    this.toolsOpen = false;
    this.eventsOpen = true;
  }

  closeEvents(): void {
    this.eventsOpen = false;
  }

  openDrawingImage(imageUrl: string): void {
    this.selectedDrawingImageUrl = imageUrl;
  }

  closeDrawingImage(): void {
    this.selectedDrawingImageUrl = '';
  }

  requestPublish(): void {
    if (!this.showSendToClient || this.disableSendToClient) {
      return;
    }

    this.requestSendToClient.emit();
  }

  setDrawMode(mode: 'freehand' | 'line'): void {
    if (!this.isDrawingMode || this.activeCanvasTool !== 'draw') {
      return;
    }

    this.drawMode = mode;
    this.resetDrawingGestureState();
  }

  async addNote(): Promise<void> {
    if (this.readonly) {
      return;
    }

    const analysis = this.analysisState;
    if (!analysis) {
      return;
    }

    const activeVideo = this.getVideoElement(this.videoMode);
    if (activeVideo && !activeVideo.paused && !activeVideo.ended) {
      activeVideo.pause();
    }

    this.toolsOpen = false;

    if (!this.isLandscapeMode) {
      this.inlineNoteTimestampSeconds = this.currentTimeSeconds;
      this.inlineNoteText = '';
      this.inlineNoteOpen = true;
      return;
    }

    const timestampSeconds = this.currentTimeSeconds;
    const noteText = await this.promptForNote();
    if (noteText === null) {
      return;
    }

    const trimmedNote = noteText.trim();
    if (!trimmedNote) {
      return;
    }

    await this.saveNote(trimmedNote, timestampSeconds, analysis);
  }

  async submitInlineNote(): Promise<void> {
    const trimmedNote = this.inlineNoteText.trim();
    const analysis = this.analysisState;
    const timestampSeconds = this.inlineNoteTimestampSeconds;

    this.cancelInlineNote();

    if (!trimmedNote || !analysis) {
      return;
    }

    await this.saveNote(trimmedNote, timestampSeconds, analysis);
  }

  cancelInlineNote(): void {
    this.inlineNoteOpen = false;
    this.inlineNoteText = '';
    this.inlineNoteTimestampSeconds = 0;
  }

  private async saveNote(note: string, timestampSeconds: number, analysis: VideoAnalysisViewerAnalysis): Promise<void> {
    const nextNote: VideoAnalysisViewerNote = {
      timestampSeconds,
      note,
      createdAtIso: new Date().toISOString(),
    };

    const nextNotes = [...analysis.notes, nextNote].sort(
      (left, right) => left.timestampSeconds - right.timestampSeconds
    );

    await this.persistNotes(analysis.id, nextNotes);
    this.updateAnalysisState({ notes: nextNotes });
  }

  async openDrawingTool(): Promise<void> {
    if (this.readonly) {
      return;
    }

    const activeVideo = this.getVideoElement(this.videoMode);
    if (!this.analysisState || !activeVideo) {
      return;
    }

    if (!activeVideo.paused && !activeVideo.ended) {
      activeVideo.pause();
    }

    this.toolsOpen = false;
    this.eventsOpen = false;
    this.selectedDrawingImageUrl = '';
    this.isDrawingMode = true;
    this.activeCanvasTool = 'draw';
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = Number.isFinite(activeVideo.currentTime) ? activeVideo.currentTime : this.currentTimeSeconds;
    this.drawMode = 'freehand';
    this.measureInstruction = '';
    this.hasMeasuredAngle = false;
    this.measureResults = [];
    this.measureSelectionPath = [];
    this.measurementBaseImageData = null;
    this.activePoseFrame = null;
    this.resetDrawingGestureState();
    this.pendingVideoSelectionSync = true;
  }

  async openAngleMeasureTool(): Promise<void> {
    if (this.readonly || !this.analysisState) {
      return;
    }

    const hasPoseFrames = await this.ensurePoseFramesForMeasurement();
    if (!hasPoseFrames) {
      await this.showInfoAlert(
        'Pose data unavailable',
        'Angle measurement requires pose data captured during recording. Re-record this workout to enable this tool.'
      );
      return;
    }

    // Always measure on the recording stream.
    // This keeps behavior consistent and lets us control skeleton rendering ourselves.
    if (this.videoMode !== 'recording' && this.recordingPlaybackUrl) {
      await this.switchVideoMode('recording');
    }

    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    await this.ensureFrameReadyForCapture(activeVideo);

    if (!activeVideo.paused && !activeVideo.ended) {
      activeVideo.pause();
    }

    this.toolsOpen = false;
    this.eventsOpen = false;
    this.selectedDrawingImageUrl = '';
    this.isDrawingMode = true;
    this.activeCanvasTool = 'measure';
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = Number.isFinite(activeVideo.currentTime) ? activeVideo.currentTime : this.currentTimeSeconds;
    this.drawMode = 'freehand';
    this.measureInstruction = 'Draw around joints or tap a joint to measure.';
    this.hasMeasuredAngle = false;
    this.measureResults = [];
    this.measureSelectionPath = [];
    this.measurementBaseImageData = null;
    this.activePoseFrame = null;
    this.resetDrawingGestureState();
    this.pendingVideoSelectionSync = true;
  }

  private async ensurePoseFramesForMeasurement(): Promise<boolean> {
    const analysis = this.analysisState;
    if (!analysis) {
      return false;
    }

    if (analysis.poseFrames?.length) {
      return true;
    }

    const poseArtifactUrl = String(analysis.poseArtifactUrl || '').trim();
    if (!poseArtifactUrl) {
      return false;
    }

    try {
      const response = await fetch(poseArtifactUrl);
      if (!response.ok) {
        return false;
      }

      const artifactData: unknown = await response.json();
      const asRecord = artifactData && typeof artifactData === 'object'
        ? (artifactData as Record<string, unknown>)
        : null;

      const normalizedFrames = normalizePoseFrames(
        asRecord?.['bodyLandmarks'] ?? artifactData,
        asRecord?.['poseAnalysis'] ?? artifactData,
      );

      if (!normalizedFrames.length) {
        return false;
      }

      this.updateAnalysisState({
        poseFrames: normalizedFrames,
        poseArtifactUrl: undefined,
      });
      return true;
    } catch {
      return false;
    }
  }

  cancelDrawingMode(): void {
    this.isDrawingMode = false;
    this.activeCanvasTool = null;
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = 0;
    this.measureInstruction = '';
    this.hasMeasuredAngle = false;
    this.measureResults = [];
    this.measureSelectionPath = [];
    this.measurementBaseImageData = null;
    this.activePoseFrame = null;
    this.resetDrawingGestureState();
  }

  async saveDrawing(): Promise<void> {
    if (this.readonly || (this.activeCanvasTool === 'measure' && !this.hasMeasuredAngle)) {
      return;
    }

    const analysis = this.analysisState;
    const canvas = this.drawingCanvasRef?.nativeElement;
    if (!analysis || !canvas || this.isSavingDrawing) {
      return;
    }

    if (!this.hasDrawingInk) {
      this.cancelDrawingMode();
      return;
    }

    if (!this.trainerId || !this.clientId) {
      return;
    }

    this.isSavingDrawing = true;

    try {
      const note = await this.promptForAttachmentNote();
      const blob = await this.canvasToBlob(canvas);
      const timestampSeconds = this.drawingTimestampSeconds || this.currentTimeSeconds;
      const createdAtIso = new Date().toISOString();
      const timestampKey = `${Date.now()}`;
      const storagePath =
        `trainers/${this.trainerId}/clients/${this.clientId}/videoAnalysis/${analysis.id}/drawings/${timestampKey}.png`;
      const file = new File([blob], `${timestampKey}.png`, { type: 'image/png' });
      const imageUrl = await this.fileUploadService.uploadFile(storagePath, file);

      const nextDrawing: VideoAnalysisViewerDrawing = {
        timestampSeconds,
        imageUrl,
        storagePath,
        createdAtIso,
        note,
      };
      const nextDrawings = [...analysis.drawings, nextDrawing].sort(
        (left, right) => left.timestampSeconds - right.timestampSeconds
      );

      await this.persistDrawings(analysis.id, nextDrawings);
      this.updateAnalysisState({ drawings: nextDrawings });
      this.cancelDrawingMode();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Unable to save this drawing right now.';
      await this.showInfoAlert('Unable to save drawing', message);
    } finally {
      this.isSavingDrawing = false;
    }
  }

  async jumpToNote(note: { timestampSeconds: number }): Promise<void> {
    this.eventsOpen = false;
    await this.jumpToTimestamp(note.timestampSeconds);
    await this.scrollToPlayerTopIfPortrait();
  }

  async jumpToDrawing(drawing: { timestampSeconds: number }): Promise<void> {
    this.eventsOpen = false;
    await this.jumpToTimestamp(drawing.timestampSeconds);
    await this.scrollToPlayerTopIfPortrait();
  }

  isTimelineNote(event: WorkoutAnalysisEvent): event is Extract<WorkoutAnalysisEvent, { kind: 'note' }> {
    return event.kind === 'note';
  }

  isTimelineDrawing(event: WorkoutAnalysisEvent): event is Extract<WorkoutAnalysisEvent, { kind: 'drawing' }> {
    return event.kind === 'drawing';
  }

  async showRecording(): Promise<void> {
    if (this.isDrawingMode) {
      return;
    }

    await this.switchVideoMode('recording');
  }

  async showOverlay(): Promise<void> {
    if (this.isDrawingMode || !this.canToggleOverlay) {
      return;
    }

    await this.switchVideoMode('overlay');
  }

  async togglePlayback(): Promise<void> {
    const lead = this.getVideoElement(this.videoMode);
    if (!lead) {
      return;
    }

    this.applySilentVideoConfig(lead);
    const videos = this.getPlaybackSyncTargets();

    if (lead.paused || lead.ended) {
      await Promise.all(videos.map(v => { this.applySilentVideoConfig(v); return v.play().catch(() => undefined); }));
      return;
    }

    videos.forEach(v => v.pause());
  }

  async onVideoSurfaceTap(event?: Event): Promise<void> {
    event?.stopPropagation();

    if (this.isDrawingMode) {
      return;
    }

    await this.togglePlayback();
  }

  onSeekInput(value: string | number): void {
    const nextPercent = Number(value);
    if (!Number.isFinite(nextPercent) || !this.durationSeconds) {
      return;
    }

    const nextTime = Math.max(0, Math.min((nextPercent / 100) * this.durationSeconds, this.durationSeconds));
    this.getPlaybackSyncTargets().forEach(v => { v.currentTime = nextTime; });
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

  onVideoMetadataLoaded(event?: Event): void {
    const sourceVideo = event?.target instanceof HTMLVideoElement
      ? event.target
      : null;
    const activeVideo = this.getVideoElement(this.videoMode);
    const metadataVideo = sourceVideo ?? activeVideo;
    if (!metadataVideo) {
      return;
    }

    this.applySilentVideoConfig(metadataVideo);
    this.playbackErrorMessage = '';
    if (activeVideo && metadataVideo === activeVideo) {
      this.durationSeconds = Number.isFinite(activeVideo.duration) ? activeVideo.duration : 0;
    }

    if (activeVideo && this.pendingSwitchResumeSeconds !== null && metadataVideo === activeVideo) {
      const safeTime = Math.max(
        0,
        Math.min(
          this.pendingSwitchResumeSeconds,
          Math.max((activeVideo.duration || this.pendingSwitchResumeSeconds) - 0.05, 0)
        )
      );
      activeVideo.currentTime = safeTime;
      this.currentTimeSeconds = safeTime;

      if (this.pendingSwitchAutoplay) {
        void Promise.all(
          this.getPlaybackSyncTargets().map((video) => {
            this.applySilentVideoConfig(video);
            if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(video.currentTime - safeTime) > 0.1) {
              video.currentTime = safeTime;
            }
            return video.play().catch(() => undefined);
          })
        );
      } else {
        this.getPlaybackSyncTargets().forEach((video) => {
          if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(video.currentTime - safeTime) > 0.1) {
            video.currentTime = safeTime;
          }
          video.pause();
        });
      }

      this.pendingSwitchResumeSeconds = null;
      this.pendingSwitchAutoplay = false;
    }

    this.schedulePortraitFrameHeightSync(activeVideo ?? metadataVideo);
  }

  onVideoError(mode: VideoMode): void {
    const modeLabel = mode === 'recording' ? 'recording' : 'overlay';
    const deviceLabel = this.isIPhoneDevice ? 'this iPhone' : 'this device';
    const failedVideo = this.getVideoElement(mode);
    const failedUrl = this.getPlaybackUrl(mode);
    const fallbackUrl = this.getFallbackUrl(mode);
    const fallbackMode: VideoMode = mode === 'recording' ? 'overlay' : 'recording';
    const fallbackModeUrl = this.getPlaybackUrl(fallbackMode);
    const mediaError = failedVideo?.error;

    console.error(`[VideoAnalysisViewer] Failed to load ${modeLabel} video`, {
      mode,
      requestedUrl: failedUrl,
      fallbackUrl,
      crossOriginEnabled: this.isCrossOriginEnabled(mode),
      errorCode: mediaError?.code ?? null,
      errorMessage: mediaError?.message ?? null,
      recordingMimeType: this.analysisState?.recordingMimeType || null,
      overlayMimeType: this.analysisState?.overlayMimeType || null,
    });

    if (failedUrl && this.isCrossOriginEnabled(mode)) {
      this.disableCrossOrigin(mode);
      this.playbackErrorMessage = `Retrying ${modeLabel} in ${deviceLabel} compatibility mode.`;
      this.reloadModeSource(mode, failedUrl);
      return;
    }

    if (fallbackUrl && failedUrl !== fallbackUrl) {
      this.setPlaybackUrl(mode, fallbackUrl);
      this.playbackErrorMessage = `The ${modeLabel} format is not supported on ${deviceLabel}. Using an alternate source.`;
      return;
    }

    if (this.videoMode === mode && fallbackModeUrl) {
      this.videoMode = fallbackMode;
      this.playbackErrorMessage = `The ${modeLabel} video is unavailable on ${deviceLabel}. Showing ${fallbackMode} instead.`;
      this.schedulePortraitFrameHeightSync(this.getVideoElement(fallbackMode));
      return;
    }

    this.playbackErrorMessage = `This analyzed video could not be played on ${deviceLabel}.`;
    this.isPlaying = false;
  }

  onVideoPlay(): void {
    this.isPlaying = true;
  }

  onVideoPause(): void {
    this.isPlaying = false;
  }

  onDrawingPointerDown(event: PointerEvent): void {
    if (!this.isDrawingMode) {
      return;
    }

    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    if (this.activeCanvasTool === 'measure') {
      const point = this.getCanvasPoint(canvas, event);
      this.measureSelectionPath = [point];
      this.drawing = true;
      canvas.setPointerCapture(event.pointerId);
      // Reset visual to base + skeleton, clearing any previous results
      if (this.measurementBaseImageData) {
        context.putImageData(this.measurementBaseImageData, 0, 0);
      }
      return;
    }

    const point = this.getCanvasPoint(canvas, event);
    this.drawing = true;
    canvas.setPointerCapture(event.pointerId);

    if (this.drawMode === 'line') {
      this.lineStartPoint = point;
      this.lastDrawPoint = point;
      this.lineSnapshot = context.getImageData(0, 0, canvas.width, canvas.height);
      return;
    }

    this.lastDrawPoint = point;
    this.drawSegment(point, point);
  }

  onDrawingPointerMove(event: PointerEvent): void {
    if (!this.isDrawingMode || !this.drawing) {
      return;
    }

    const canvas = this.drawingCanvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    if (this.activeCanvasTool === 'measure') {
      if (this.measureSelectionPath.length === 0) {
        return;
      }
      const point = this.getCanvasPoint(canvas, event);
      this.measureSelectionPath.push(point);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        this.renderLassoPreview(ctx, canvas);
      }
      return;
    }

    if (!this.lastDrawPoint) {
      return;
    }

    const point = this.getCanvasPoint(canvas, event);

    if (this.drawMode === 'line') {
      const context = canvas.getContext('2d');
      if (!context || !this.lineStartPoint || !this.lineSnapshot) {
        return;
      }

      context.putImageData(this.lineSnapshot, 0, 0);
      this.drawSegment(this.lineStartPoint, point, false);
      this.lastDrawPoint = point;
      return;
    }

    this.drawSegment(this.lastDrawPoint, point);
    this.lastDrawPoint = point;
  }

  onDrawingPointerUp(event: PointerEvent): void {
    if (!this.isDrawingMode) {
      return;
    }

    const canvas = this.drawingCanvasRef?.nativeElement;

    if (this.activeCanvasTool === 'measure') {
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      this.drawing = false;

      const path = this.measureSelectionPath;
      this.measureSelectionPath = [];

      if (!canvas || !this.activePoseFrame || !this.measurementBaseImageData || path.length === 0) {
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      if (this.isMeasureTap(canvas, path)) {
        this.handleMeasureTap(canvas, path[0], context);
      } else {
        this.handleLassoMeasure(canvas, context, path);
      }
      return;
    }

    if (this.drawMode === 'line' && this.drawing && canvas && this.lineStartPoint) {
      const context = canvas.getContext('2d');
      const point = this.getCanvasPoint(canvas, event);
      if (context && this.lineSnapshot) {
        context.putImageData(this.lineSnapshot, 0, 0);
      }
      this.drawSegment(this.lineStartPoint, point);
    }

    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    this.resetDrawingGestureState();
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

  formatAnalysisDate(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return trimmed;
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(parsed).replace(',', '');
  }

  private updateAnalysisState(patch: Partial<VideoAnalysisViewerAnalysis>): void {
    if (!this.analysisState) {
      return;
    }

    this.analysisState = {
      ...this.analysisState,
      ...patch,
    };
    this.analysisChange.emit(this.analysisState);
  }

  private async initializeSelectedVideoState(): Promise<void> {
    const recordingVideo = this.recordingVideoRef?.nativeElement;
    const overlayVideo = this.overlayVideoRef?.nativeElement;
    const activeMode = this.resolvePreferredVideoMode(this.videoMode);
    const activeVideo = this.getVideoElement(activeMode);
    if (!activeVideo) {
      this.pendingVideoSelectionSync = true;
      return;
    }
    this.videoMode = activeMode;

    if (this.isDrawingMode) {
      if (recordingVideo) {
        this.applySilentVideoConfig(recordingVideo);
      }
      if (overlayVideo) {
        this.applySilentVideoConfig(overlayVideo);
      }

      activeVideo.pause();
      this.isPlaying = false;
      this.currentTimeSeconds = Number.isFinite(activeVideo.currentTime) ? activeVideo.currentTime : 0;
      this.durationSeconds = Number.isFinite(activeVideo.duration) ? activeVideo.duration : this.durationSeconds;
      await this.prepareDrawingCanvas(activeVideo);
      this.schedulePortraitFrameHeightSync(activeVideo);
      return;
    }

    if (recordingVideo) {
      recordingVideo.currentTime = 0;
      recordingVideo.pause();
      this.applySilentVideoConfig(recordingVideo);
    }
    if (overlayVideo) {
      overlayVideo.currentTime = 0;
      overlayVideo.pause();
      this.applySilentVideoConfig(overlayVideo);
    }

    this.currentTimeSeconds = 0;
    this.durationSeconds = Number.isFinite(activeVideo.duration) ? activeVideo.duration : 0;
    this.schedulePortraitFrameHeightSync(activeVideo);
    void this.waitForMetadata(activeVideo)
      .then(() => {
        this.durationSeconds = Number.isFinite(activeVideo.duration) ? activeVideo.duration : this.durationSeconds;
        this.schedulePortraitFrameHeightSync(activeVideo);
      })
      .catch(() => undefined);
    void Promise.all(this.getPlaybackSyncTargets().map(v => v.play().catch(() => undefined)));
  }

  private async switchVideoMode(targetMode: VideoMode): Promise<void> {
    if (!this.analysisState || this.videoMode === targetMode || this.isSwitchingVideo) {
      return;
    }
    if (!this.getPlaybackUrl(targetMode)) {
      return;
    }

    const lead = this.getVideoElement(this.videoMode);
    const targetVideo = this.getVideoElement(targetMode);
    if (!targetVideo) {
      return;
    }

    const resumeSeconds =
      lead && Number.isFinite(lead.currentTime) ? lead.currentTime : this.currentTimeSeconds;
    const shouldAutoplay = !!lead && !lead.paused && !lead.ended;
    const safeResumeSeconds = Number.isFinite(resumeSeconds) ? resumeSeconds : 0;

    this.videoMode = targetMode;

    if (targetVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.applySilentVideoConfig(targetVideo);
      const safeTime = Math.max(
        0,
        Math.min(resumeSeconds, Math.max((targetVideo.duration || resumeSeconds) - 0.05, 0))
      );
      if (Math.abs(targetVideo.currentTime - safeTime) > 0.1) {
        targetVideo.currentTime = safeTime;
      }
      this.durationSeconds = Number.isFinite(targetVideo.duration) ? targetVideo.duration : this.durationSeconds;
      this.currentTimeSeconds = safeTime;
      this.pendingSwitchResumeSeconds = null;
      this.pendingSwitchAutoplay = false;

      const syncTargets = this.getPlaybackSyncTargets();
      syncTargets.forEach((video) => {
        this.applySilentVideoConfig(video);
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(video.currentTime - safeTime) > 0.1) {
          video.currentTime = safeTime;
        }
      });

      if (shouldAutoplay) {
        void Promise.all(syncTargets.map((video) => video.play().catch(() => undefined)));
      } else {
        syncTargets.forEach((video) => video.pause());
      }
    } else {
      // Target metadata not yet loaded; onVideoMetadataLoaded will apply the seek.
      this.pendingSwitchResumeSeconds = safeResumeSeconds;
      this.pendingSwitchAutoplay = shouldAutoplay;

      if (!shouldAutoplay) {
        lead?.pause();
      }
    }

    this.schedulePortraitFrameHeightSync(targetVideo);
  }

  private getVideoElement(mode: VideoMode): HTMLVideoElement | null {
    if (mode === 'overlay') {
      return this.overlayVideoRef?.nativeElement ?? null;
    }

    return this.recordingVideoRef?.nativeElement ?? null;
  }

  private getAllVideoElements(): HTMLVideoElement[] {
    return [
      this.recordingVideoRef?.nativeElement,
      this.overlayVideoRef?.nativeElement,
    ].filter((v): v is HTMLVideoElement => v != null);
  }

  private getPlaybackSyncTargets(): HTMLVideoElement[] {
    if (!this.shouldLazyLoadInactiveVideo) {
      return this.getAllVideoElements();
    }

    const activeVideo = this.getVideoElement(this.videoMode);
    return activeVideo ? [activeVideo] : [];
  }

  private applySilentVideoConfig(video: HTMLVideoElement): void {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
  }

  private async prepareDrawingCanvas(activeVideo: HTMLVideoElement): Promise<void> {
    const canvas = this.drawingCanvasRef?.nativeElement;
    if (!canvas) {
      this.pendingVideoSelectionSync = true;
      return;
    }

    await this.waitForCurrentFrame(activeVideo).catch(() => undefined);
    let context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const width = activeVideo.videoWidth || activeVideo.clientWidth || 1280;
    const height = activeVideo.videoHeight || activeVideo.clientHeight || 720;
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    let frameSourceVideo = activeVideo;
    let canUseVideoFrameAsCanvasBase = true;
    const resetCanvasBitmap = (): CanvasRenderingContext2D | null => {
      canvas.width = width;
      canvas.height = height;
      return canvas.getContext('2d');
    };
    const renderFrame = async (video: HTMLVideoElement): Promise<void> => {
      await this.waitForCurrentFrame(video).catch(() => undefined);
      context?.clearRect(0, 0, width, height);
      context?.drawImage(video, 0, 0, width, height);
    };

    try {
      await renderFrame(frameSourceVideo);
    } catch (error) {
      try {
        const recoveredVideo = await this.ensureCanvasSafeSource(this.videoMode);
        if (recoveredVideo) {
          frameSourceVideo = recoveredVideo;
        }
        await renderFrame(frameSourceVideo);
      } catch (recoveryError) {
        console.error('[VideoAnalysisViewer] Failed to render active video frame onto canvas', {
          initialError: error,
          recoveryError,
        });
        canUseVideoFrameAsCanvasBase = false;
      }
    }

    // Avoid tainted canvas on iPhone by switching to a local cached playback URL
    // before any readback-dependent operations (getImageData / toBlob).
    if (canUseVideoFrameAsCanvasBase && !this.isCanvasReadbackSafe(context)) {
      const recoveredVideo = await this.ensureCanvasSafeSource(this.videoMode);
      if (recoveredVideo) {
        frameSourceVideo = recoveredVideo;
        try {
          await renderFrame(frameSourceVideo);
        } catch (error) {
          console.error('[VideoAnalysisViewer] Failed to render canvas-safe source', error);
          canUseVideoFrameAsCanvasBase = false;
        }
      }
    }

    if (canUseVideoFrameAsCanvasBase && !this.isCanvasReadbackSafe(context)) {
      canUseVideoFrameAsCanvasBase = false;
    }

    if (!canUseVideoFrameAsCanvasBase) {
      const resetContext = resetCanvasBitmap();
      if (!resetContext) {
        return;
      }
      context = resetContext;

      // Keep tools usable even when iOS blocks canvas readback from remote media.
      // We intentionally avoid painting video pixels onto this canvas.
      context.clearRect(0, 0, width, height);

      if (this.activeCanvasTool === 'measure') {
        const timeMs = this.drawingTimestampSeconds * 1000;
        const poseFrame = this.findNearestPoseFrame(timeMs);
        this.activePoseFrame = poseFrame;

        if (poseFrame) {
          this.drawSkeletonOnCanvas(context, canvas, poseFrame);
          this.measureInstruction = 'Video frame capture is blocked on iPhone. Measuring from pose skeleton.';
        } else {
          this.measureInstruction = 'Pose data unavailable for this frame.';
        }

        try {
          this.measurementBaseImageData = context.getImageData(0, 0, width, height);
        } catch (error) {
          this.measurementBaseImageData = null;
          this.activePoseFrame = null;
          this.measureInstruction = 'Angle measurement is unavailable for this frame on iPhone.';
          console.error('[VideoAnalysisViewer] Failed to initialize fallback measurement canvas snapshot', error);
          return;
        }
      } else {
        this.measurementBaseImageData = null;
        this.activePoseFrame = null;
      }

      this.alignCanvasToVideoContent(canvas, frameSourceVideo);
      return;
    }

    if (!this.isCanvasReadbackSafe(context)) {
      if (this.activeCanvasTool === 'measure') {
        this.measureInstruction = 'Angle measurement is unavailable for this frame on iPhone.';
      }
      return;
    }

    // Position the canvas to exactly cover the video's rendered content area so
    // that canvas pixel coordinates align with the video's visible skeleton.
    this.alignCanvasToVideoContent(canvas, frameSourceVideo);

    if (this.activeCanvasTool === 'measure') {
      // Find and cache the nearest pose frame for this timestamp.
      const timeMs = this.drawingTimestampSeconds * 1000;
      const poseFrame = this.findNearestPoseFrame(timeMs);
      this.activePoseFrame = poseFrame;

      // Draw skeleton only when the measured frame does not already include one.
      if (poseFrame && this.shouldDrawMeasureSkeletonOverlay()) {
        this.drawSkeletonOnCanvas(context, canvas, poseFrame);
      }

      // Snapshot the video frame (+ skeleton if drawn above) — used to restore canvas before each re-render.
      try {
        this.measurementBaseImageData = context.getImageData(0, 0, width, height);
      } catch (error) {
        this.measurementBaseImageData = null;
        this.activePoseFrame = null;
        this.measureInstruction = 'Angle measurement is unavailable for this video source on iPhone.';
        console.error('[VideoAnalysisViewer] Failed to initialize measurement canvas snapshot', error);
        return;
      }

      if (!poseFrame) {
        this.measureInstruction = 'Pose data unavailable for this frame.';
      }
    } else {
      this.measurementBaseImageData = null;
    }
  }

  /**
   * Positions the canvas element so it exactly covers the video's rendered
   * content area, accounting for `object-fit: contain` letterboxing.
   * CSS layout rules alone cannot guarantee sub-pixel alignment across all
   * aspect ratios and orientations, so we measure the real positions with
   * getBoundingClientRect and apply explicit inline styles.
   */
  private alignCanvasToVideoContent(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
    const frame = this.playerFrameRef?.nativeElement;
    if (!frame) {
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const videoWidth = video.videoWidth || video.clientWidth;
    const videoHeight = video.videoHeight || video.clientHeight;
    const elementWidth = videoRect.width;
    const elementHeight = videoRect.height;

    if (!videoWidth || !videoHeight || !elementWidth || !elementHeight) {
      return;
    }

    // Scale that object-fit: contain applies to the video content.
    const scale = Math.min(elementWidth / videoWidth, elementHeight / videoHeight);
    const contentWidth = videoWidth * scale;
    const contentHeight = videoHeight * scale;

    // object-position: top center (portrait) → no vertical offset
    //                  center center (landscape) → centered vertically
    const offsetX = (elementWidth - contentWidth) / 2;
    const offsetY = this.isPortraitViewport() ? 0 : (elementHeight - contentHeight) / 2;

    // Coordinates relative to the player-frame (canvas's containing block).
    const top = videoRect.top - frameRect.top + offsetY;
    const left = videoRect.left - frameRect.left + offsetX;

    canvas.style.position = 'absolute';
    canvas.style.top = `${top}px`;
    canvas.style.left = `${left}px`;
    canvas.style.width = `${contentWidth}px`;
    canvas.style.height = `${contentHeight}px`;
    canvas.style.transform = 'none';
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
  }

  private async promptForNote(): Promise<string | null> {
    return new Promise<string | null>(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'Add note',
        message: `Save a note at ${this.formatTime(this.currentTimeSeconds)}.`,
        inputs: [{ name: 'note', type: 'textarea', placeholder: 'Write your note...' }],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          { text: 'Save', handler: (value: { note?: string }) => resolve(String(value?.note || '')) },
        ],
      });

      await alert.present();
    });
  }

  private async promptForAttachmentNote(): Promise<string> {
    return new Promise<string>(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'Add note?',
        message: `Add an optional note at ${this.formatTime(this.drawingTimestampSeconds || this.currentTimeSeconds)}.`,
        inputs: [{ name: 'note', type: 'textarea', placeholder: 'Write a note for this image...' }],
        buttons: [
          { text: 'Skip', role: 'cancel', handler: () => resolve('') },
          { text: 'Save', handler: (value: { note?: string }) => resolve(String(value?.note || '').trim()) },
        ],
      });

      await alert.present();
    });
  }

  private async persistNotes(analysisId: string, notes: VideoAnalysisViewerNote[]): Promise<void> {
    if (!this.trainerId || !this.clientId || !analysisId) {
      return;
    }

    const analysisRef = doc(this.firestore, `trainers/${this.trainerId}/clients/${this.clientId}/videoAnalysis/${analysisId}`);
    await setDoc(analysisRef, { notes }, { merge: true });
  }

  private async persistDrawings(analysisId: string, drawings: VideoAnalysisViewerDrawing[]): Promise<void> {
    if (!this.trainerId || !this.clientId || !analysisId) {
      return;
    }

    const analysisRef = doc(this.firestore, `trainers/${this.trainerId}/clients/${this.clientId}/videoAnalysis/${analysisId}`);
    await setDoc(analysisRef, { drawings }, { merge: true });
  }

  private async waitForMetadata(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.applySilentVideoConfig(video);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Video metadata failed to load.')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });
  }

  private async waitForCurrentFrame(video: HTMLVideoElement): Promise<void> {
    await this.waitForMetadata(video);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.applySilentVideoConfig(video);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Video frame failed to load.')); };
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  private async ensureFrameReadyForCapture(video: HTMLVideoElement): Promise<void> {
    await this.waitForMetadata(video).catch(() => undefined);
    this.applySilentVideoConfig(video);

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await video.play().catch(() => undefined);
      await this.delay(140);
      video.pause();
    }

    await this.delay(80);
    await this.waitForCurrentFrame(video).catch(() => undefined);
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  private async jumpToTimestamp(timestampSeconds: number): Promise<void> {
    const lead = this.getVideoElement(this.videoMode);
    if (!lead) {
      return;
    }

    await this.waitForMetadata(lead).catch(() => undefined);
    const safeTime = Math.max(0, Math.min(timestampSeconds, Math.max((lead.duration || timestampSeconds) - 0.05, 0)));
    this.getPlaybackSyncTargets().forEach(v => { v.currentTime = safeTime; });
    this.currentTimeSeconds = safeTime;
    await Promise.all(this.getPlaybackSyncTargets().map(v => v.play().catch(() => undefined)));
  }

  private async scrollToPlayerTopIfPortrait(): Promise<void> {
    if (this.isLandscapeMode) {
      return;
    }

    await this.delay(0);

    this.playerShellRef?.nativeElement.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
  }

  private schedulePortraitFrameHeightSync(video?: HTMLVideoElement | null): void {
    window.requestAnimationFrame(() => {
      this.updatePortraitFrameHeight(video ?? this.getVideoElement(this.videoMode));
    });
  }

  private updatePortraitFrameHeight(video: HTMLVideoElement | null): void {
    if (!this.isPortraitViewport()) {
      this.portraitPlayerFrameHeightPx = null;
      return;
    }

    const frameWidth = this.playerFrameRef?.nativeElement.clientWidth ?? 0;
    const videoWidth = video?.videoWidth ?? 0;
    const videoHeight = video?.videoHeight ?? 0;
    if (!frameWidth || !videoWidth || !videoHeight) {
      return;
    }

    const contentHeight = frameWidth * (videoHeight / videoWidth);
    this.portraitPlayerFrameHeightPx = Math.round(contentHeight + (this.portraitPlayerGutterPx * 2));
  }

  private isPortraitViewport(): boolean {
    return window.innerHeight >= window.innerWidth;
  }

  private getCanvasPoint(canvas: HTMLCanvasElement, event: PointerEvent): CanvasPoint {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  private drawSegment(from: CanvasPoint, to: CanvasPoint, commitInk = true): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    context.strokeStyle = '#ff4d4f';
    context.lineWidth = Math.max(4, canvas.width * 0.0045);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (commitInk) {
      this.hasDrawingInk = true;
    }
  }

  // ─── Pose-based angle measurement ────────────────────────────────────────────

  /**
   * Main handler for a tap in measure mode.
   * Finds the nearest measurable joint, computes its angle from stored pose data,
   * and renders the result. Replaces any previously measured results.
   */
  private handleMeasureTap(canvas: HTMLCanvasElement, tapPoint: CanvasPoint, context: CanvasRenderingContext2D): void {
    const poseFrame = this.activePoseFrame;
    if (!poseFrame) {
      this.measureInstruction = 'Pose data unavailable for this frame.';
      return;
    }

    const normX = tapPoint.x / canvas.width;
    const normY = tapPoint.y / canvas.height;

    const nearestJoint = this.findNearestLandmark(normX, normY, poseFrame);
    if (!nearestJoint) {
      this.measureInstruction = 'No joint found near tap. Try tapping closer to a highlighted joint.';
      return;
    }

    const result = this.computePoseJointAngle(nearestJoint, poseFrame, canvas);
    if (!result) {
      this.measureInstruction = `Cannot measure ${this.formatJointName(nearestJoint)} — one or more connected landmarks are not visible.`;
      return;
    }

    this.measureResults = [result];
    this.hasMeasuredAngle = true;
    this.hasDrawingInk = true;
    this.measureInstruction = `${this.formatJointName(nearestJoint)}: ${result.angleDegrees.toFixed(1)}°. Draw or tap again.`;

    this.renderPoseAngleResults([result], poseFrame, canvas, context);
  }

  /**
   * Binary search for the stored pose frame closest in time to `timeMs`.
   * Assumes frames are ordered by ascending timeMs (guaranteed by analyzeVideo).
   */
  private findNearestPoseFrame(timeMs: number): VideoAnalysisFrame | null {
    const frames = this.analysisState?.poseFrames;
    if (!frames?.length) {
      return null;
    }

    let low = 0;
    let high = frames.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (frames[mid].timeMs < timeMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    // low is the first frame with timeMs >= target; compare with low-1 to pick closer.
    if (low > 0 && Math.abs(frames[low - 1].timeMs - timeMs) <= Math.abs(frames[low].timeMs - timeMs)) {
      return frames[low - 1];
    }

    return frames[low];
  }

  /**
   * Returns the nearest measurable joint within a generous tap radius.
   * Only joints that have a defined angle pair are candidates.
   * Returns null when no joint is close enough.
   */
  private findNearestLandmark(
    normX: number,
    normY: number,
    frame: VideoAnalysisFrame,
  ): VideoLandmarkName | null {
    const maxRadius = 0.1; // normalized — approximately 10% of the frame dimension
    let nearestName: VideoLandmarkName | null = null;
    let minDist = maxRadius;

    for (const [name, point] of Object.entries(frame.landmarks) as [VideoLandmarkName, VideoAnalysisPoint | undefined][]) {
      if (!point || (point.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD) {
        continue;
      }

      if (!(name in JOINT_ANGLE_MEASUREMENT_PAIRS)) {
        continue;
      }

      const dist = Math.hypot(point.x - normX, point.y - normY);
      if (dist < minDist) {
        minDist = dist;
        nearestName = name;
      }
    }

    return nearestName;
  }

  /**
   * Computes the angle at `joint` using real pose landmark positions.
   * Uses the anatomically defined pair from JOINT_ANGLE_MEASUREMENT_PAIRS.
   * Returns null when any of the three required landmarks are not visible.
   */
  private computePoseJointAngle(
    joint: VideoLandmarkName,
    frame: VideoAnalysisFrame,
    canvas: HTMLCanvasElement,
  ): AngleMeasurementResult | null {
    const pair = JOINT_ANGLE_MEASUREMENT_PAIRS[joint];
    if (!pair) {
      return null;
    }

    const jointPoint = frame.landmarks[joint];
    const pointA = frame.landmarks[pair[0]];
    const pointB = frame.landmarks[pair[1]];

    if (!jointPoint || !pointA || !pointB) {
      return null;
    }

    if (
      (jointPoint.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD ||
      (pointA.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD ||
      (pointB.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD
    ) {
      return null;
    }

    const vertex: CanvasPoint = {
      x: jointPoint.x * canvas.width,
      y: jointPoint.y * canvas.height,
    };
    const firstEnd: CanvasPoint = {
      x: pointA.x * canvas.width,
      y: pointA.y * canvas.height,
    };
    const secondEnd: CanvasPoint = {
      x: pointB.x * canvas.width,
      y: pointB.y * canvas.height,
    };

    const dirA = { x: firstEnd.x - vertex.x, y: firstEnd.y - vertex.y };
    const dirB = { x: secondEnd.x - vertex.x, y: secondEnd.y - vertex.y };

    return {
      jointName: joint,
      vertex,
      firstEnd,
      secondEnd,
      angleDegrees: this.computeSmallerAngle(dirA, dirB),
    };
  }

  /**
   * Draws the full pose skeleton on the canvas as a semi-transparent overlay.
   * Measurable joints are highlighted with a larger, brighter dot so users know
   * where to tap.
   */
  private drawSkeletonOnCanvas(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    frame: VideoAnalysisFrame,
  ): void {
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, canvas.width * 0.0035);

    // Connections
    context.strokeStyle = 'rgba(27, 232, 183, 0.55)';
    for (const [from, to] of POSE_CONNECTIONS) {
      const startPoint = frame.landmarks[from];
      const endPoint = frame.landmarks[to];
      if (
        !startPoint || !endPoint ||
        (startPoint.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD ||
        (endPoint.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD
      ) {
        continue;
      }

      context.beginPath();
      context.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height);
      context.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height);
      context.stroke();
    }

    // Joint dots — measurable joints are brighter and larger
    for (const [name, point] of Object.entries(frame.landmarks) as [VideoLandmarkName, VideoAnalysisPoint | undefined][]) {
      if (!point || (point.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD) {
        continue;
      }

      const isMeasurable = name in JOINT_ANGLE_MEASUREMENT_PAIRS;
      context.fillStyle = isMeasurable
        ? 'rgba(27, 232, 183, 0.92)'
        : 'rgba(27, 232, 183, 0.35)';
      context.beginPath();
      context.arc(
        point.x * canvas.width,
        point.y * canvas.height,
        isMeasurable ? Math.max(6, canvas.width * 0.009) : Math.max(3, canvas.width * 0.005),
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    context.restore();
  }

  /**
   * Renders all measured angle results:
   *   1. Restores the clean video frame (base snapshot).
   *   2. Redraws the skeleton overlay so joints remain visible.
   *   3. For each result, draws the two limb lines (orange → A, cyan → B).
   *   4. Then draws all dots and labels on top so they are never occluded by lines.
   */
  private renderPoseAngleResults(
    results: AngleMeasurementResult[],
    frame: VideoAnalysisFrame,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
  ): void {
    this.restoreMeasurementBase();

    const lineWidth = Math.max(5, canvas.width * 0.005);
    const fontSize = Math.max(20, canvas.width * 0.028);
    const dotRadius = Math.max(7, canvas.width * 0.011);

    context.save();
    context.lineWidth = lineWidth;
    context.lineCap = 'round';

    // Pass 1: draw all limb lines
    for (const result of results) {
      context.strokeStyle = '#ff8a00';
      context.beginPath();
      context.moveTo(result.vertex.x, result.vertex.y);
      context.lineTo(result.firstEnd.x, result.firstEnd.y);
      context.stroke();

      context.strokeStyle = '#4cc9f0';
      context.beginPath();
      context.moveTo(result.vertex.x, result.vertex.y);
      context.lineTo(result.secondEnd.x, result.secondEnd.y);
      context.stroke();
    }

    // Pass 2: draw all dots and labels so they sit on top of the lines
    context.font = `bold ${fontSize}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.shadowColor = 'rgba(0, 0, 0, 0.85)';
    context.shadowBlur = 5;

    for (const result of results) {
      context.fillStyle = '#ffffff';
      context.shadowColor = 'rgba(0, 0, 0, 0.85)';
      context.shadowBlur = 5;
      context.beginPath();
      context.arc(result.vertex.x, result.vertex.y, dotRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = '#ffffff';
      context.fillText(
        `${result.angleDegrees.toFixed(1)}°`,
        result.vertex.x,
        result.vertex.y - dotRadius - 4,
      );
    }

    context.restore();
  }

  /**
   * Handles a lasso gesture: finds all measurable joints whose canvas positions
   * fall inside the drawn path and renders all their angles simultaneously.
   */
  private handleLassoMeasure(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    path: CanvasPoint[],
  ): void {
    const poseFrame = this.activePoseFrame;
    if (!poseFrame) {
      return;
    }

    const lassoPath = new Path2D();
    lassoPath.moveTo(path[0].x, path[0].y);
    for (const pt of path.slice(1)) {
      lassoPath.lineTo(pt.x, pt.y);
    }
    lassoPath.closePath();

    const results: AngleMeasurementResult[] = [];
    const labels: string[] = [];

    for (const jointName of Object.keys(JOINT_ANGLE_MEASUREMENT_PAIRS) as VideoLandmarkName[]) {
      const point = poseFrame.landmarks[jointName];
      if (!point || (point.visibility ?? 1) < LANDMARK_VISIBILITY_THRESHOLD) {
        continue;
      }

      const cx = point.x * canvas.width;
      const cy = point.y * canvas.height;
      if (!context.isPointInPath(lassoPath, cx, cy)) {
        continue;
      }

      const result = this.computePoseJointAngle(jointName, poseFrame, canvas);
      if (result) {
        results.push(result);
        labels.push(`${this.formatJointName(jointName)}: ${result.angleDegrees.toFixed(1)}°`);
      }
    }

    if (results.length === 0) {
      // Nothing inside — restore clean display and prompt again
      this.restoreMeasurementBase();
      this.measureInstruction = 'No joints found inside the selection. Try drawing around a highlighted joint.';
      return;
    }

    this.measureResults = results;
    this.hasMeasuredAngle = true;
    this.hasDrawingInk = true;
    this.measureInstruction = labels.join('  ·  ') + '. Draw or tap again.';
    this.renderPoseAngleResults(results, poseFrame, canvas, context);
  }

  /**
   * Renders a live preview of the lasso being drawn: restores base + skeleton,
   * then draws a dashed outline of the current selection path.
   */
  private renderLassoPreview(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.measurementBaseImageData) {
      return;
    }

    this.restoreMeasurementBase();

    const path = this.measureSelectionPath;
    if (path.length < 2) {
      return;
    }

    context.save();
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    context.lineWidth = Math.max(2, canvas.width * 0.002);
    context.setLineDash([Math.max(6, canvas.width * 0.01), Math.max(4, canvas.width * 0.007)]);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for (const pt of path.slice(1)) {
      context.lineTo(pt.x, pt.y);
    }
    context.stroke();
    context.restore();
  }

  /**
   * Returns true when the gesture looks like a tap rather than a lasso —
   * i.e. all recorded points stayed within ~3% of the canvas width from the start.
   */
  private isMeasureTap(canvas: HTMLCanvasElement, path: CanvasPoint[]): boolean {
    if (path.length < 2) {
      return true;
    }

    const start = path[0];
    const threshold = canvas.width * 0.03;
    for (const pt of path) {
      if (Math.hypot(pt.x - start.x, pt.y - start.y) > threshold) {
        return false;
      }
    }

    return true;
  }

  private formatJointName(name: VideoLandmarkName): string {
    return name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
  }

  // ─────────────────────────────────────────────────────────────────────────────

  private restoreMeasurementBase(): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !this.measurementBaseImageData) {
      return;
    }

    context.putImageData(this.measurementBaseImageData, 0, 0);
  }

  private shouldDrawMeasureSkeletonOverlay(): boolean {
    // Overlay mode already includes skeleton in the captured frame.
    return this.videoMode !== 'overlay';
  }

  private isCanvasReadbackSafe(context: CanvasRenderingContext2D): boolean {
    try {
      context.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  }

  private computeSmallerAngle(first: CanvasPoint, second: CanvasPoint): number {
    const dot = (first.x * second.x) + (first.y * second.y);
    const firstMagnitude = Math.hypot(first.x, first.y);
    const secondMagnitude = Math.hypot(second.x, second.y);
    if (!firstMagnitude || !secondMagnitude) {
      return 0;
    }

    const normalized = Math.max(-1, Math.min(1, dot / (firstMagnitude * secondMagnitude)));
    const angle = Math.acos(normalized) * (180 / Math.PI);
    return angle > 180 ? 360 - angle : angle;
  }

  private resetDrawingGestureState(): void {
    this.drawing = false;
    this.lastDrawPoint = null;
    this.lineStartPoint = null;
    this.lineSnapshot = null;
  }

  private async canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error('Failed to save drawing.'));
        }, 'image/png');
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error('Failed to save drawing.')
        );
      }
    });
  }

  private async showInfoAlert(header: string, message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK'],
    });

    await alert.present();
  }

  private configurePlaybackSources(shouldPrefetchSources = true): void {
    const analysis = this.analysisState;
    if (!analysis) {
      this.recordingPlaybackUrl = '';
      this.overlayPlaybackUrl = '';
      this.recordingFallbackUrl = '';
      this.overlayFallbackUrl = '';
      return;
    }

    const recordingMimeType = this.resolveMimeType(
      analysis.recordingMimeType,
      analysis.recordingUrl,
    );
    const overlayMimeType = this.resolveMimeType(
      analysis.overlayMimeType,
      analysis.overlayUrl,
    );

    const recordingCandidates = this.buildPlaybackCandidates(
      analysis.recordingUrl,
      recordingMimeType,
      '',
      '',
    );
    const overlayCandidates = this.buildPlaybackCandidates(
      analysis.overlayUrl,
      overlayMimeType,
      analysis.overlayUrl ? analysis.recordingUrl : '',
      analysis.overlayUrl ? recordingMimeType : '',
      false,
    );

    const recordingPlaybackCandidates = this.resolveCachedPlaybackCandidates(recordingCandidates);
    const overlayPlaybackCandidates = this.resolveCachedPlaybackCandidates(overlayCandidates);

    this.recordingPlaybackUrl = recordingPlaybackCandidates[0] ?? '';
    this.recordingFallbackUrl = recordingPlaybackCandidates[1] ?? '';
    this.overlayPlaybackUrl = overlayPlaybackCandidates[0] ?? '';
    this.overlayFallbackUrl = overlayPlaybackCandidates[1] ?? '';

    if (shouldPrefetchSources && this.videoPlaybackCacheService.shouldPrefetchInBackground()) {
      void this.prefetchActiveAnalysisSources(analysis.id, [analysis.recordingUrl, analysis.overlayUrl]);
    }
  }

  private resolveCachedPlaybackCandidates(candidates: string[]): string[] {
    const resolved = candidates
      .map((url) => this.videoPlaybackCacheService.resolvePlaybackUrl(url))
      .filter((url): url is string => !!url.trim());

    return Array.from(new Set(resolved));
  }

  private async prefetchActiveAnalysisSources(analysisId: string, sourceUrls: string[]): Promise<void> {
    const urls = Array.from(
      new Set(
        sourceUrls
          .map((url) => String(url || '').trim())
          .filter((url) => !!url)
      )
    );

    if (!urls.length) {
      return;
    }

    const beforeCacheUrls = urls.map((url) => this.videoPlaybackCacheService.resolvePlaybackUrl(url));
    await Promise.all(urls.map((url) => this.videoPlaybackCacheService.prefetchUrl(url)));

    if (analysisId !== this.analysisState?.id) {
      return;
    }

    if (this.isPlaying || this.isDrawingMode) {
      return;
    }

    const afterCacheUrls = urls.map((url) => this.videoPlaybackCacheService.resolvePlaybackUrl(url));
    const cacheStateChanged = afterCacheUrls.some((url, index) => url !== beforeCacheUrls[index]);
    if (!cacheStateChanged) {
      return;
    }

    this.configurePlaybackSources(false);
  }

  private buildPlaybackCandidates(
    preferredUrl: string,
    preferredMimeType: string,
    alternateUrl: string,
    alternateMimeType: string,
    preferAlternateWhenPreferredUnsupported = true,
  ): string[] {
    const preferred = preferredUrl.trim();
    const alternate = alternateUrl.trim();
    if (!preferred && !alternate) {
      return [];
    }

    const preferredSupport = this.getPlaybackSupport(preferredMimeType);
    const alternateSupport = this.getPlaybackSupport(alternateMimeType);
    const shouldPreferAlternate =
      preferAlternateWhenPreferredUnsupported &&
      preferredSupport === 'unsupported' &&
      alternateSupport !== 'unsupported' &&
      !!alternate;

    const ordered = shouldPreferAlternate
      ? [alternate, preferred]
      : [preferred, alternate];

    return Array.from(new Set(ordered.filter(url => !!url)));
  }

  private getPlaybackSupport(mimeType: string): 'supported' | 'unsupported' | 'unknown' {
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized) {
      return 'unknown';
    }

    if (this.isIPhoneDevice && normalized.includes('webm')) {
      return 'unsupported';
    }

    const supportValue = this.supportProbeVideo.canPlayType(normalized);
    if (supportValue === 'probably' || supportValue === 'maybe') {
      return 'supported';
    }

    return supportValue ? 'unknown' : 'unsupported';
  }

  private resolveMimeType(explicitMimeType: string | undefined, videoUrl: string): string {
    const direct = String(explicitMimeType || '').trim();
    if (direct) {
      return direct;
    }

    const lowerUrl = videoUrl.trim().toLowerCase();
    if (!lowerUrl) {
      return '';
    }

    if (lowerUrl.includes('.mp4')) {
      return 'video/mp4';
    }

    if (lowerUrl.includes('.webm')) {
      return 'video/webm';
    }

    return '';
  }

  private resolvePreferredVideoMode(preferred: VideoMode): VideoMode {
    if (preferred === 'overlay' && this.overlayPlaybackUrl) {
      return 'overlay';
    }

    if (this.recordingPlaybackUrl) {
      return 'recording';
    }

    if (this.overlayPlaybackUrl) {
      return 'overlay';
    }

    return 'recording';
  }

  private getPlaybackUrl(mode: VideoMode): string {
    return mode === 'recording'
      ? this.recordingPlaybackUrl
      : this.overlayPlaybackUrl;
  }

  private getFallbackUrl(mode: VideoMode): string {
    return mode === 'recording'
      ? this.recordingFallbackUrl
      : this.overlayFallbackUrl;
  }

  private setPlaybackUrl(mode: VideoMode, url: string): void {
    if (mode === 'recording') {
      this.recordingPlaybackUrl = url;
      return;
    }

    this.overlayPlaybackUrl = url;
  }

  private async ensureCanvasSafeSource(mode: VideoMode): Promise<HTMLVideoElement | null> {
    if (!this.analysisState) {
      return null;
    }

    const sourceUrl = String(
      mode === 'recording' ? this.analysisState.recordingUrl : this.analysisState.overlayUrl
    ).trim();
    if (!sourceUrl || sourceUrl.startsWith('blob:') || sourceUrl.startsWith('data:')) {
      return this.getVideoElement(mode);
    }

    const localPlaybackUrl = await this.videoPlaybackCacheService.prefetchUrl(sourceUrl, {
      force: true,
      maxEntryBytes: this.canvasSafePrefetchMaxBytes,
      timeoutMs: this.canvasSafePrefetchTimeoutMs,
    });
    if (!localPlaybackUrl || localPlaybackUrl === sourceUrl || localPlaybackUrl === this.getPlaybackUrl(mode)) {
      return this.getVideoElement(mode);
    }

    const activeVideo = this.getVideoElement(mode);
    const resumeSeconds =
      activeVideo && Number.isFinite(activeVideo.currentTime)
        ? activeVideo.currentTime
        : this.currentTimeSeconds;
    const shouldResumePlayback = !!activeVideo && !activeVideo.paused && !activeVideo.ended;

    activeVideo?.pause();
    this.setPlaybackUrl(mode, localPlaybackUrl);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const localVideo = this.getVideoElement(mode);
    if (!localVideo) {
      return null;
    }

    await this.waitForMetadata(localVideo).catch(() => undefined);

    if (Number.isFinite(resumeSeconds)) {
      const duration = Number.isFinite(localVideo.duration) ? localVideo.duration : resumeSeconds;
      const safeSeek = Math.max(0, Math.min(resumeSeconds, Math.max(duration - 0.05, 0)));
      localVideo.currentTime = safeSeek;
      this.currentTimeSeconds = safeSeek;
    }

    if (shouldResumePlayback) {
      void localVideo.play().catch(() => undefined);
    }

    return localVideo;
  }

  private resetCrossOriginPolicy(): void {
    // iOS Safari can stall remote media with crossorigin enabled.
    // Drawing mode lazily switches to local blob playback when frame capture is required.
    const enableCrossOrigin = !this.readonly && !this.isIPhoneDevice;
    this.recordingCrossOriginEnabled = enableCrossOrigin;
    this.overlayCrossOriginEnabled = enableCrossOrigin;
  }

  private isCrossOriginEnabled(mode: VideoMode): boolean {
    return mode === 'recording'
      ? this.recordingCrossOriginEnabled
      : this.overlayCrossOriginEnabled;
  }

  private disableCrossOrigin(mode: VideoMode): void {
    if (mode === 'recording') {
      this.recordingCrossOriginEnabled = false;
      return;
    }

    this.overlayCrossOriginEnabled = false;
  }

  private reloadModeSource(mode: VideoMode, sourceUrl: string): void {
    this.setPlaybackUrl(mode, '');
    window.setTimeout(() => {
      this.setPlaybackUrl(mode, sourceUrl);
    }, 0);
  }
}
