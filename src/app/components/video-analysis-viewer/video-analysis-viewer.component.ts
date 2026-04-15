import { CommonModule } from '@angular/common';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
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
} from './video-analysis-viewer.types';

type CanvasPoint = { x: number; y: number };

type AngleMeasurementResult = {
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

@Component({
  selector: 'app-video-analysis-viewer',
  standalone: true,
  templateUrl: './video-analysis-viewer.component.html',
  styleUrls: ['./video-analysis-viewer.component.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonButtons,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar,
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

  analysisState: VideoAnalysisViewerAnalysis | null = null;
  videoMode: 'recording' | 'overlay' = 'recording';
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
  isMeasureSelectionReady = false;
  hasMeasuredAngle = false;
  portraitPlayerFrameHeightPx: number | null = null;

  private pendingVideoSelectionSync = false;
  private drawing = false;
  private lastAnalysisId = '';
  private lastDrawPoint: CanvasPoint | null = null;
  private lineStartPoint: CanvasPoint | null = null;
  private lineSnapshot: ImageData | null = null;
  private measurementBaseImageData: ImageData | null = null;
  private measureSelectionPath: CanvasPoint[] = [];
  private measureResult: AngleMeasurementResult | null = null;
  private readonly portraitPlayerGutterPx = 84;

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
    if ('analysis' in changes) {
      const nextAnalysis = this.analysis;
      const nextId = nextAnalysis?.id || '';
      if (nextId && nextId !== this.lastAnalysisId) {
        this.lastAnalysisId = nextId;
        this.selectAnalysis(nextAnalysis);
      } else if (!nextId) {
        this.lastAnalysisId = '';
        this.analysisState = null;
      } else if (nextAnalysis) {
        this.analysisState = {
          ...nextAnalysis,
          notes: [...nextAnalysis.notes],
          drawings: [...nextAnalysis.drawings],
        };
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
    return !!this.analysisState?.overlayUrl;
  }

  get isRecordingMode(): boolean {
    return this.videoMode === 'recording';
  }

  get hasEvents(): boolean {
    return this.timelineEvents.length > 0;
  }

  get isLandscapeMode(): boolean {
    return !this.isPortraitViewport();
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
    this.videoMode = 'recording';
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
    this.isMeasureSelectionReady = false;
    this.hasMeasuredAngle = false;
    this.measureSelectionPath = [];
    this.measureResult = null;
    this.measurementBaseImageData = null;
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

    const timestampSeconds = this.currentTimeSeconds;
    const noteText = await this.promptForNote();
    if (noteText === null) {
      return;
    }

    const trimmedNote = noteText.trim();
    if (!trimmedNote) {
      return;
    }

    const nextNote: VideoAnalysisViewerNote = {
      timestampSeconds,
      note: trimmedNote,
      createdAtIso: new Date().toISOString(),
    };

    const nextNotes = [...analysis.notes, nextNote].sort(
      (left, right) => left.timestampSeconds - right.timestampSeconds
    );

    await this.persistNotes(analysis.id, nextNotes);
    this.updateAnalysisState({ notes: nextNotes });
    this.toolsOpen = false;
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
    this.isMeasureSelectionReady = false;
    this.hasMeasuredAngle = false;
    this.measureSelectionPath = [];
    this.measureResult = null;
    this.measurementBaseImageData = null;
    this.resetDrawingGestureState();
    this.pendingVideoSelectionSync = true;
  }

  async openAngleMeasureTool(): Promise<void> {
    if (this.readonly || !this.analysisState) {
      return;
    }

    if (!this.canToggleOverlay) {
      await this.showInfoAlert('Overlay unavailable', 'This workout does not have an overlay video to measure.');
      return;
    }

    if (this.videoMode !== 'overlay') {
      await this.switchVideoMode('overlay');
    }

    const activeVideo = this.getVideoElement('overlay');
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
    this.measureInstruction = 'Circle the two skeleton lines you want to measure.';
    this.isMeasureSelectionReady = false;
    this.hasMeasuredAngle = false;
    this.measureSelectionPath = [];
    this.measureResult = null;
    this.measurementBaseImageData = null;
    this.resetDrawingGestureState();
    this.pendingVideoSelectionSync = true;
  }

  cancelDrawingMode(): void {
    this.isDrawingMode = false;
    this.activeCanvasTool = null;
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = 0;
    this.measureInstruction = '';
    this.isMeasureSelectionReady = false;
    this.hasMeasuredAngle = false;
    this.measureSelectionPath = [];
    this.measureResult = null;
    this.measurementBaseImageData = null;
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

  async onVideoSurfaceTap(event?: Event): Promise<void> {
    event?.stopPropagation();

    if (this.isDrawingMode) {
      return;
    }

    await this.togglePlayback();
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
    this.schedulePortraitFrameHeightSync(activeVideo);
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
      this.beginMeasureSelection(canvas, event);
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
      this.extendMeasureSelection(canvas, event);
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
      this.finishMeasureSelection(canvas ?? null, event);
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
    if (!recordingVideo) {
      this.pendingVideoSelectionSync = true;
      return;
    }

    if (this.isDrawingMode) {
      const activeVideo = this.getVideoElement(this.videoMode);
      if (!activeVideo) {
        this.pendingVideoSelectionSync = true;
        return;
      }

      this.applySilentVideoConfig(recordingVideo);
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
    this.schedulePortraitFrameHeightSync(recordingVideo);
    void recordingVideo.play().catch(() => undefined);
  }

  private async switchVideoMode(targetMode: 'recording' | 'overlay'): Promise<void> {
    if (!this.analysisState || this.videoMode === targetMode || this.isSwitchingVideo) {
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

      this.schedulePortraitFrameHeightSync(targetVideo);
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

  private async prepareDrawingCanvas(activeVideo: HTMLVideoElement): Promise<void> {
    const canvas = this.drawingCanvasRef?.nativeElement;
    if (!canvas) {
      this.pendingVideoSelectionSync = true;
      return;
    }

    await this.waitForCurrentFrame(activeVideo).catch(() => undefined);
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const width = activeVideo.videoWidth || activeVideo.clientWidth || 1280;
    const height = activeVideo.videoHeight || activeVideo.clientHeight || 720;
    canvas.width = width;
    canvas.height = height;

    context.clearRect(0, 0, width, height);
    context.drawImage(activeVideo, 0, 0, width, height);
    if (this.activeCanvasTool === 'measure') {
      this.measurementBaseImageData = context.getImageData(0, 0, width, height);
    } else {
      this.measurementBaseImageData = null;
    }
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
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    await this.waitForMetadata(activeVideo).catch(() => undefined);
    const safeTime = Math.max(0, Math.min(timestampSeconds, Math.max((activeVideo.duration || timestampSeconds) - 0.05, 0)));
    activeVideo.currentTime = safeTime;
    this.currentTimeSeconds = safeTime;
    await activeVideo.play().catch(() => undefined);
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

  async measureSelectedAngle(): Promise<void> {
    if (this.activeCanvasTool !== 'measure' || !this.isMeasureSelectionReady) {
      return;
    }

    const result = this.detectAngleWithinSelection();
    if (!result) {
      await this.showInfoAlert('Angle not found', 'Try circling a smaller area around one visible joint and the two connecting skeleton lines.');
      return;
    }

    this.measureResult = result;
    this.hasMeasuredAngle = true;
    this.measureInstruction = `${result.angleDegrees.toFixed(1)} deg measured. Save when ready.`;
    this.renderMeasuredAngle(result);
    this.hasDrawingInk = true;
  }

  private beginMeasureSelection(canvas: HTMLCanvasElement, event: PointerEvent): void {
    this.drawing = true;
    canvas.setPointerCapture(event.pointerId);
    this.measureSelectionPath = [this.getCanvasPoint(canvas, event)];
    this.isMeasureSelectionReady = false;
    this.hasMeasuredAngle = false;
    this.measureResult = null;
    this.restoreMeasurementBase();
    this.renderMeasureSelectionPreview(true);
  }

  private extendMeasureSelection(canvas: HTMLCanvasElement, event: PointerEvent): void {
    const point = this.getCanvasPoint(canvas, event);
    this.measureSelectionPath = [...this.measureSelectionPath, point];
    this.renderMeasureSelectionPreview();
  }

  private finishMeasureSelection(canvas: HTMLCanvasElement | null, event: PointerEvent): void {
    if (!canvas) {
      return;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    this.drawing = false;

    if (this.measureSelectionPath.length < 3) {
      this.measureSelectionPath = [];
      this.isMeasureSelectionReady = false;
      this.restoreMeasurementBase();
      return;
    }

    this.renderMeasureSelectionPreview(true);
    this.isMeasureSelectionReady = true;
    this.measureInstruction = 'Selection ready. Press Measure Angle.';
    this.resetDrawingGestureState();
  }

  private detectAngleWithinSelection(): AngleMeasurementResult | null {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    const baseImage = this.measurementBaseImageData;
    if (!canvas || !context || !baseImage || this.measureSelectionPath.length < 3) {
      return null;
    }

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskContext = maskCanvas.getContext('2d');
    if (!maskContext) {
      return null;
    }

    const path = new Path2D();
    path.moveTo(this.measureSelectionPath[0].x, this.measureSelectionPath[0].y);
    for (let index = 1; index < this.measureSelectionPath.length; index += 1) {
      const point = this.measureSelectionPath[index];
      path.lineTo(point.x, point.y);
    }
    path.closePath();

    const sampleStep = Math.max(2, Math.round(canvas.width / 220));
    const selectedPoints: CanvasPoint[] = [];
    const data = baseImage.data;

    for (let y = 0; y < canvas.height; y += sampleStep) {
      for (let x = 0; x < canvas.width; x += sampleStep) {
        if (!maskContext.isPointInPath(path, x, y)) {
          continue;
        }

        const offset = ((y * canvas.width) + x) * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const alpha = data[offset + 3];
        if (alpha < 120) {
          continue;
        }

        const isOverlayPixel = green > 150 && blue > 150 && red < 120 && blue - red > 60;
        if (isOverlayPixel) {
          selectedPoints.push({ x, y });
        }
      }
    }

    if (selectedPoints.length < 12) {
      return null;
    }

    const centroid = {
      x: selectedPoints.reduce((sum, point) => sum + point.x, 0) / selectedPoints.length,
      y: selectedPoints.reduce((sum, point) => sum + point.y, 0) / selectedPoints.length,
    };

    // Initial partition: split by X relative to centroid; fall back to Y split
    const partitionA: CanvasPoint[] = [];
    const partitionB: CanvasPoint[] = [];

    for (const point of selectedPoints) {
      if (point.x <= centroid.x) {
        partitionA.push(point);
      } else {
        partitionB.push(point);
      }
    }

    let groupA = partitionA.length >= 6 ? partitionA : selectedPoints.filter((point) => point.y <= centroid.y);
    let groupB = partitionB.length >= 6 ? partitionB : selectedPoints.filter((point) => point.y > centroid.y);

    if (groupA.length < 6 || groupB.length < 6) {
      return null;
    }

    // Iterative k-means refinement: reassign each point to whichever fitted line
    // it sits closer to (perpendicular distance). Runs up to 3 passes.
    for (let iter = 0; iter < 3; iter += 1) {
      const lineA = this.fitLine(groupA);
      const lineB = this.fitLine(groupB);
      if (!lineA || !lineB) {
        break;
      }

      const nextA: CanvasPoint[] = [];
      const nextB: CanvasPoint[] = [];
      for (const point of selectedPoints) {
        const dA = this.perpendicularDistance(point, lineA.mean, lineA.direction);
        const dB = this.perpendicularDistance(point, lineB.mean, lineB.direction);
        if (dA <= dB) {
          nextA.push(point);
        } else {
          nextB.push(point);
        }
      }

      if (nextA.length < 6 || nextB.length < 6) {
        break;
      }
      groupA = nextA;
      groupB = nextB;
    }

    if (groupA.length < 6 || groupB.length < 6) {
      return null;
    }

    const firstLine = this.fitLine(groupA);
    const secondLine = this.fitLine(groupB);
    if (!firstLine || !secondLine) {
      return null;
    }

    // Vertex = actual intersection of the two fitted lines (the joint position).
    // Falls back to the pixel centroid only when lines are near-parallel or the
    // intersection is implausibly far from the selection.
    const maxFallbackDist = Math.max(canvas.width, canvas.height) * 0.6;
    const rawIntersection = this.intersectLines(
      firstLine.mean, firstLine.direction,
      secondLine.mean, secondLine.direction
    );
    const vertex =
      rawIntersection &&
      Math.hypot(rawIntersection.x - centroid.x, rawIntersection.y - centroid.y) <= maxFallbackDist
        ? rawIntersection
        : centroid;

    // Orient each direction so it points from the vertex toward its cluster mean,
    // ensuring the overlay lines extend along the skeleton arms not away from them.
    const dirA = { ...firstLine.direction };
    if ((firstLine.mean.x - vertex.x) * dirA.x + (firstLine.mean.y - vertex.y) * dirA.y < 0) {
      dirA.x = -dirA.x;
      dirA.y = -dirA.y;
    }

    const dirB = { ...secondLine.direction };
    if ((secondLine.mean.x - vertex.x) * dirB.x + (secondLine.mean.y - vertex.y) * dirB.y < 0) {
      dirB.x = -dirB.x;
      dirB.y = -dirB.y;
    }

    const lineExtent = Math.max(80, Math.round(canvas.width * 0.1));
    const firstEnd = this.extendLinePoint(vertex, dirA, lineExtent);
    const secondEnd = this.extendLinePoint(vertex, dirB, lineExtent);
    const angleDegrees = this.computeSmallerAngle(dirA, dirB);

    return {
      vertex,
      firstEnd,
      secondEnd,
      angleDegrees,
    };
  }

  private fitLine(points: CanvasPoint[]): { direction: CanvasPoint; mean: CanvasPoint } | null {
    if (points.length < 2) {
      return null;
    }

    let meanX = 0;
    let meanY = 0;
    for (const point of points) {
      meanX += point.x;
      meanY += point.y;
    }
    meanX /= points.length;
    meanY /= points.length;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const point of points) {
      const dx = point.x - meanX;
      const dy = point.y - meanY;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const direction = { x: Math.cos(theta), y: Math.sin(theta) };
    return direction.x || direction.y ? { direction, mean: { x: meanX, y: meanY } } : null;
  }

  private intersectLines(
    pointA: CanvasPoint, dirA: CanvasPoint,
    pointB: CanvasPoint, dirB: CanvasPoint
  ): CanvasPoint | null {
    // Solve pointA + t*dirA = pointB + s*dirB  →  Cramer's rule on (t, s)
    const det = dirA.x * (-dirB.y) - dirA.y * (-dirB.x);
    if (Math.abs(det) < 1e-6) {
      return null; // parallel
    }
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const t = (dx * (-dirB.y) - dy * (-dirB.x)) / det;
    return { x: pointA.x + t * dirA.x, y: pointA.y + t * dirA.y };
  }

  private perpendicularDistance(point: CanvasPoint, linePoint: CanvasPoint, lineDir: CanvasPoint): number {
    const dx = point.x - linePoint.x;
    const dy = point.y - linePoint.y;
    return Math.abs(dx * lineDir.y - dy * lineDir.x);
  }

  private extendLinePoint(origin: CanvasPoint, direction: CanvasPoint, distance: number): CanvasPoint {
    return {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
    };
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

  private renderMeasuredAngle(result: AngleMeasurementResult): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    this.restoreMeasurementBase();
    this.renderMeasureSelectionPreview(true);

    context.save();
    context.lineWidth = Math.max(5, canvas.width * 0.005);
    context.lineCap = 'round';
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

    context.fillStyle = '#ffffff';
    context.font = `${Math.max(20, canvas.width * 0.028)}px sans-serif`;
    context.textAlign = 'center';
    context.fillText(`${result.angleDegrees.toFixed(1)} deg`, result.vertex.x, result.vertex.y - 18);
    context.restore();
  }

  private renderMeasureSelectionPreview(finalize = false): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !this.measurementBaseImageData || this.measureSelectionPath.length < 2) {
      return;
    }

    this.restoreMeasurementBase();

    context.save();
    context.fillStyle = 'rgba(0, 0, 0, 0.36)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const path = new Path2D();
    path.moveTo(this.measureSelectionPath[0].x, this.measureSelectionPath[0].y);
    for (let index = 1; index < this.measureSelectionPath.length; index += 1) {
      const point = this.measureSelectionPath[index];
      path.lineTo(point.x, point.y);
    }
    if (finalize) {
      path.closePath();
    }

    context.save();
    context.clip(path);
    context.putImageData(this.measurementBaseImageData, 0, 0);
    context.restore();

    // Marching-ants selection outline: white solid base then black dashes on top
    const dashLen = Math.max(6, Math.round(canvas.width * 0.008));
    context.lineWidth = Math.max(2, canvas.width * 0.0028);
    context.lineJoin = 'round';
    context.lineCap = 'butt';
    context.strokeStyle = '#ffffff';
    context.setLineDash([]);
    context.stroke(path);
    context.strokeStyle = '#000000';
    context.setLineDash([dashLen, dashLen]);
    context.stroke(path);
    context.setLineDash([]);
    context.restore();
  }

  private restoreMeasurementBase(): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !this.measurementBaseImageData) {
      return;
    }

    context.putImageData(this.measurementBaseImageData, 0, 0);
  }

  private resetDrawingGestureState(): void {
    this.drawing = false;
    this.lastDrawPoint = null;
    this.lineStartPoint = null;
    this.lineSnapshot = null;
  }

  private async canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Failed to save drawing.'));
      }, 'image/png');
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
}
