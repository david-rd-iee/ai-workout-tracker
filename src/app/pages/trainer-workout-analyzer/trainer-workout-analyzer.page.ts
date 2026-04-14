import { AfterViewChecked, Component, ElementRef, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  AlertController,
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
import { Firestore } from '@angular/fire/firestore';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { AccountService } from '../../services/account/account.service';
import { FileUploadService } from '../../services/file-upload.service';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  brushOutline,
  buildOutline,
  documentTextOutline,
  imageOutline,
  pauseOutline,
  playOutline,
} from 'ionicons/icons';

type WorkoutAnalysisMenuItem = {
  id: string;
  label: string;
  analyzedAtIso: string;
  workoutName: string;
  recordingUrl: string;
  overlayUrl: string;
  notes: WorkoutAnalysisNote[];
  drawings: WorkoutAnalysisDrawing[];
};

type WorkoutAnalysisNote = {
  timestampSeconds: number;
  note: string;
  createdAtIso: string;
};

type WorkoutAnalysisDrawing = {
  timestampSeconds: number;
  imageUrl: string;
  storagePath: string;
  createdAtIso: string;
  note: string;
};

type CanvasPoint = {
  x: number;
  y: number;
};

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
  @ViewChild(IonContent) private contentRef?: IonContent;
  @ViewChild('playerShell') private playerShellRef?: ElementRef<HTMLDivElement>;
  @ViewChild('playerFrame') private playerFrameRef?: ElementRef<HTMLDivElement>;
  @ViewChild('recordingVideo') private recordingVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayVideo') private overlayVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('drawingCanvas') private drawingCanvasRef?: ElementRef<HTMLCanvasElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly accountService = inject(AccountService);
  private readonly firestore = inject(Firestore);
  private readonly navCtrl = inject(NavController);
  private readonly alertCtrl = inject(AlertController);
  private readonly fileUploadService = inject(FileUploadService);

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
      brushOutline,
      buildOutline,
      documentTextOutline,
      imageOutline,
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

  @HostListener('window:resize')
  onWindowResize(): void {
    this.schedulePortraitFrameHeightSync();
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

  get activeAnalysisDisplayDate(): string {
    return this.formatAnalysisDate(this.selectedAnalysis?.analyzedAtIso || '');
  }

  get activeAnalysisDisplayTitle(): string {
    return this.selectedAnalysis?.workoutName || '';
  }

  get canToggleOverlay(): boolean {
    return !!this.selectedAnalysis?.overlayUrl;
  }

  get isRecordingMode(): boolean {
    return this.videoMode === 'recording';
  }

  get hasNotes(): boolean {
    return (this.selectedAnalysis?.notes.length ?? 0) > 0;
  }

  get hasDrawings(): boolean {
    return (this.selectedAnalysis?.drawings.length ?? 0) > 0;
  }

  get hasEvents(): boolean {
    return this.timelineEvents.length > 0;
  }

  get isLandscapeMode(): boolean {
    return !this.isPortraitViewport();
  }

  get timelineEvents(): WorkoutAnalysisEvent[] {
    const analysis = this.selectedAnalysis;
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
    this.pendingVideoSelectionSync = true;
  }

  toggleTools(): void {
    if (this.isDrawingMode) {
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

  setDrawMode(mode: 'freehand' | 'line'): void {
    if (!this.isDrawingMode || this.activeCanvasTool !== 'draw') {
      return;
    }

    this.drawMode = mode;
    this.resetDrawingGestureState();
  }

  async addNote(): Promise<void> {
    const analysis = this.selectedAnalysis;
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

    const nextNote: WorkoutAnalysisNote = {
      timestampSeconds,
      note: trimmedNote,
      createdAtIso: new Date().toISOString(),
    };

    const nextNotes = [...analysis.notes, nextNote].sort(
      (left, right) => left.timestampSeconds - right.timestampSeconds
    );

    await this.persistNotes(analysis.id, nextNotes);

    this.workoutAnalyses = this.workoutAnalyses.map((item) =>
      item.id === analysis.id ? { ...item, notes: nextNotes } : item
    );
    this.selectedAnalysis = {
      ...analysis,
      notes: nextNotes,
    };
    this.toolsOpen = false;
  }

  async openDrawingTool(): Promise<void> {
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!this.selectedAnalysis || !activeVideo) {
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
    if (!this.selectedAnalysis) {
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
    if (this.activeCanvasTool === 'measure' && !this.hasMeasuredAngle) {
      return;
    }

    const analysis = this.selectedAnalysis;
    const canvas = this.drawingCanvasRef?.nativeElement;
    if (!analysis || !canvas || this.isSavingDrawing) {
      return;
    }

    if (!this.hasDrawingInk) {
      this.cancelDrawingMode();
      return;
    }

    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId || !this.clientId) {
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
        `trainers/${trainerId}/clients/${this.clientId}/videoAnalysis/${analysis.id}/drawings/${timestampKey}.png`;
      const file = new File([blob], `${timestampKey}.png`, { type: 'image/png' });
      const imageUrl = await this.fileUploadService.uploadFile(storagePath, file);

      const nextDrawing: WorkoutAnalysisDrawing = {
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

      this.workoutAnalyses = this.workoutAnalyses.map((item) =>
        item.id === analysis.id ? { ...item, drawings: nextDrawings } : item
      );
      this.selectedAnalysis = {
        ...analysis,
        drawings: nextDrawings,
      };
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

  noteTimestampLabel(note: WorkoutAnalysisNote): string {
    return `${this.formatTime(note.timestampSeconds)}:${note.note}`;
  }

  drawingTimestampLabel(drawing: WorkoutAnalysisDrawing): string {
    return this.formatTime(drawing.timestampSeconds);
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
            workoutName,
            recordingUrl,
            overlayUrl,
            notes: this.readNotes(data['notes']),
            drawings: this.readDrawings(data['drawings']),
          };
        })
        .filter((analysis) => !!analysis.recordingUrl)
        .sort((left, right) => right.analyzedAtIso.localeCompare(left.analyzedAtIso))
        .map(({ id, label, analyzedAtIso, workoutName, recordingUrl, overlayUrl, notes, drawings }) => ({
          id,
          label,
          analyzedAtIso,
          workoutName,
          recordingUrl,
          overlayUrl,
          notes,
          drawings,
        }));

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
        inputs: [
          {
            name: 'note',
            type: 'textarea',
            placeholder: 'Write your note...',
          },
        ],
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => resolve(null),
          },
          {
            text: 'Save',
            handler: (value: { note?: string }) => resolve(String(value?.note || '')),
          },
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
        inputs: [
          {
            name: 'note',
            type: 'textarea',
            placeholder: 'Write a note for this image...',
          },
        ],
        buttons: [
          {
            text: 'Skip',
            role: 'cancel',
            handler: () => resolve(''),
          },
          {
            text: 'Save',
            handler: (value: { note?: string }) => resolve(String(value?.note || '').trim()),
          },
        ],
      });

      await alert.present();
    });
  }

  private async persistNotes(analysisId: string, notes: WorkoutAnalysisNote[]): Promise<void> {
    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId || !this.clientId || !analysisId) {
      return;
    }

    const analysisRef = doc(
      this.firestore,
      `trainers/${trainerId}/clients/${this.clientId}/videoAnalysis/${analysisId}`
    );
    await setDoc(
      analysisRef,
      {
        notes,
      },
      { merge: true }
    );
  }

  private async persistDrawings(analysisId: string, drawings: WorkoutAnalysisDrawing[]): Promise<void> {
    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId || !this.clientId || !analysisId) {
      return;
    }

    const analysisRef = doc(
      this.firestore,
      `trainers/${trainerId}/clients/${this.clientId}/videoAnalysis/${analysisId}`
    );
    await setDoc(
      analysisRef,
      {
        drawings,
      },
      { merge: true }
    );
  }

  private readNotes(value: unknown): WorkoutAnalysisNote[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        const note = this.asRecord(entry);
        if (!note) {
          return null;
        }

        const timestampSeconds = Number(note['timestampSeconds']);
        const noteText = typeof note['note'] === 'string' ? note['note'].trim() : '';
        const createdAtIso = typeof note['createdAtIso'] === 'string' ? note['createdAtIso'].trim() : '';
        if (!Number.isFinite(timestampSeconds) || !noteText) {
          return null;
        }

        return {
          timestampSeconds,
          note: noteText,
          createdAtIso,
        };
      })
      .filter((note): note is WorkoutAnalysisNote => note !== null)
      .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
  }

  private readDrawings(value: unknown): WorkoutAnalysisDrawing[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        const drawing = this.asRecord(entry);
        if (!drawing) {
          return null;
        }

        const timestampSeconds = Number(drawing['timestampSeconds']);
        const imageUrl = typeof drawing['imageUrl'] === 'string' ? drawing['imageUrl'].trim() : '';
        const storagePath = typeof drawing['storagePath'] === 'string' ? drawing['storagePath'].trim() : '';
        const createdAtIso = typeof drawing['createdAtIso'] === 'string' ? drawing['createdAtIso'].trim() : '';
        const note = typeof drawing['note'] === 'string' ? drawing['note'].trim() : '';
        if (!Number.isFinite(timestampSeconds) || !imageUrl) {
          return null;
        }

        return {
          timestampSeconds,
          imageUrl,
          storagePath,
          createdAtIso,
          note,
        };
      })
      .filter((drawing): drawing is WorkoutAnalysisDrawing => drawing !== null)
      .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
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

  private async waitForCurrentFrame(video: HTMLVideoElement): Promise<void> {
    await this.waitForMetadata(video);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
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
        reject(new Error('Video frame failed to load.'));
      };
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
    const safeTime = Math.max(
      0,
      Math.min(timestampSeconds, Math.max((activeVideo.duration || timestampSeconds) - 0.05, 0))
    );
    activeVideo.currentTime = safeTime;
    this.currentTimeSeconds = safeTime;
    await activeVideo.play().catch(() => undefined);
  }

  private async scrollToPlayerTopIfPortrait(): Promise<void> {
    if (this.isLandscapeMode) {
      return;
    }

    await this.delay(0);

    const playerShell = this.playerShellRef?.nativeElement;
    if (playerShell) {
      playerShell.scrollIntoView({
        behavior: 'auto',
        block: 'start',
        inline: 'nearest',
      });
      return;
    }

    await this.contentRef?.scrollToTop(0);
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

  formatSavedAnalysisLabel(analysis: WorkoutAnalysisMenuItem): string {
    const formattedDate = this.formatAnalysisDate(analysis.analyzedAtIso);
    return analysis.workoutName ? `${formattedDate} : ${analysis.workoutName}` : formattedDate;
  }

  private formatAnalysisDate(value: string): string {
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private getCanvasPoint(
    canvas: HTMLCanvasElement,
    event: PointerEvent
  ): CanvasPoint {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  private drawSegment(
    from: { x: number; y: number },
    to: { x: number; y: number },
    commitInk = true
  ): void {
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
      await this.showInfoAlert(
        'Angle not found',
        'Try circling a smaller area around one visible joint and the two connecting skeleton lines.'
      );
      return;
    }

    this.measureResult = result;
    this.hasMeasuredAngle = true;
    this.hasDrawingInk = true;
    this.measureInstruction = `${result.angleDegrees.toFixed(1)} degrees measured.`;
    this.renderMeasureSelection(true);
  }

  private beginMeasureSelection(canvas: HTMLCanvasElement, event: PointerEvent): void {
    const point = this.getCanvasPoint(canvas, event);
    this.drawing = true;
    this.lastDrawPoint = point;
    this.measureSelectionPath = [point];
    this.isMeasureSelectionReady = false;
    this.hasMeasuredAngle = false;
    this.hasDrawingInk = false;
    this.measureResult = null;
    this.measureInstruction = 'Keep circling the two lines, then release.';
    canvas.setPointerCapture(event.pointerId);
    this.renderMeasureSelection(false);
  }

  private extendMeasureSelection(canvas: HTMLCanvasElement, event: PointerEvent): void {
    const point = this.getCanvasPoint(canvas, event);
    this.measureSelectionPath = [...this.measureSelectionPath, point];
    this.lastDrawPoint = point;
    this.renderMeasureSelection(false);
  }

  private finishMeasureSelection(canvas: HTMLCanvasElement | null, event: PointerEvent): void {
    if (!canvas) {
      this.resetDrawingGestureState();
      return;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (this.measureSelectionPath.length < 8) {
      this.measureInstruction = 'Circle a little wider around the two lines.';
      this.measureSelectionPath = [];
      this.resetDrawingGestureState();
      this.renderMeasureSelection(false);
      return;
    }

    const firstPoint = this.measureSelectionPath[0];
    this.measureSelectionPath = [...this.measureSelectionPath, firstPoint];
    this.isMeasureSelectionReady = true;
    this.measureInstruction = 'Selection ready. Tap Measure Angle.';
    this.renderMeasureSelection(false);
    this.resetDrawingGestureState();
  }

  private renderMeasureSelection(showResult: boolean): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    const baseImage = this.measurementBaseImageData;
    if (!canvas || !context || !baseImage) {
      return;
    }

    context.putImageData(baseImage, 0, 0);

    if (this.measureSelectionPath.length >= 2) {
      context.save();
      context.fillStyle = 'rgba(0, 0, 0, 0.34)';
      context.beginPath();
      context.rect(0, 0, canvas.width, canvas.height);
      this.traceSelectionPath(context, this.measureSelectionPath);
      context.fill('evenodd');
      context.restore();

      context.save();
      context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      context.lineWidth = Math.max(3, canvas.width * 0.003);
      context.setLineDash([14, 10]);
      this.traceSelectionPath(context, this.measureSelectionPath);
      context.stroke();
      context.restore();
    }

    if (showResult && this.measureResult) {
      this.drawHighlightedMeasureLine(this.measureResult.vertex, this.measureResult.firstEnd, '#ff9f1c');
      this.drawHighlightedMeasureLine(this.measureResult.vertex, this.measureResult.secondEnd, '#ff4d6d');
      this.renderAngleLabel(this.measureResult.vertex, this.measureResult.angleDegrees);
    }
  }

  private traceSelectionPath(context: CanvasRenderingContext2D, points: CanvasPoint[]): void {
    if (!points.length) {
      return;
    }

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.closePath();
  }

  private detectAngleWithinSelection(): AngleMeasurementResult | null {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const baseImage = this.measurementBaseImageData;
    if (!canvas || !baseImage || this.measureSelectionPath.length < 4) {
      return null;
    }

    const bounds = this.getSelectionBounds(this.measureSelectionPath, canvas.width, canvas.height);
    const pixels: CanvasPoint[] = [];
    const data = baseImage.data;

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (!this.isPointInPolygon({ x, y }, this.measureSelectionPath)) {
          continue;
        }

        const pixelIndex = ((y * canvas.width) + x) * 4;
        if (this.isSkeletonOverlayPixel(
          data[pixelIndex],
          data[pixelIndex + 1],
          data[pixelIndex + 2],
          data[pixelIndex + 3]
        )) {
          pixels.push({ x, y });
        }
      }
    }

    if (pixels.length < 50) {
      return null;
    }

    const vertex = this.findLikelyJointPoint(pixels);
    if (!vertex) {
      return null;
    }

    const vectors = pixels
      .map((point) => ({
        point,
        dx: point.x - vertex.x,
        dy: point.y - vertex.y,
      }))
      .map((entry) => ({
        ...entry,
        distance: Math.hypot(entry.dx, entry.dy),
        angle: Math.atan2(entry.dy, entry.dx),
      }))
      .filter((entry) => entry.distance > 14);

    if (vectors.length < 20) {
      return null;
    }

    const firstCluster = this.findDominantAngleCluster(vectors, []);
    if (!firstCluster) {
      return null;
    }

    const secondCluster = this.findDominantAngleCluster(vectors, [firstCluster.angle]);
    if (!secondCluster) {
      return null;
    }

    const angleDegrees = this.angleDifferenceDegrees(firstCluster.angle, secondCluster.angle);
    return {
      vertex,
      firstEnd: firstCluster.endpoint,
      secondEnd: secondCluster.endpoint,
      angleDegrees,
    };
  }

  private findLikelyJointPoint(points: CanvasPoint[]): CanvasPoint | null {
    if (!points.length) {
      return null;
    }

    const sampleStep = Math.max(1, Math.floor(points.length / 220));
    const radius = 14;
    const radiusSquared = radius * radius;
    let bestPoint = points[0];
    let bestScore = -1;

    for (let index = 0; index < points.length; index += sampleStep) {
      const candidate = points[index];
      let localCount = 0;

      for (const point of points) {
        const dx = point.x - candidate.x;
        const dy = point.y - candidate.y;
        if ((dx * dx) + (dy * dy) <= radiusSquared) {
          localCount += 1;
        }
      }

      if (localCount > bestScore) {
        bestScore = localCount;
        bestPoint = candidate;
      }
    }

    return bestPoint;
  }

  private findDominantAngleCluster(
    vectors: Array<{ point: CanvasPoint; distance: number; angle: number }>,
    excludedAngles: number[]
  ): { angle: number; endpoint: CanvasPoint } | null {
    const binCount = 90;
    const binSize = (Math.PI * 2) / binCount;
    const histogram = new Array<number>(binCount).fill(0);
    const normalizedExcluded = excludedAngles.map((angle) => this.normalizeAngle(angle));

    for (const vector of vectors) {
      const normalized = this.normalizeAngle(vector.angle);
      if (normalizedExcluded.some((excluded) => this.angularDistance(normalized, excluded) < 0.36)) {
        continue;
      }

      const binIndex = Math.floor(normalized / binSize) % binCount;
      histogram[binIndex] += 1;
    }

    let bestIndex = -1;
    let bestCount = 0;
    for (let index = 0; index < histogram.length; index += 1) {
      if (histogram[index] > bestCount) {
        bestCount = histogram[index];
        bestIndex = index;
      }
    }

    if (bestIndex === -1 || bestCount < 4) {
      return null;
    }

    const targetAngle = (bestIndex + 0.5) * binSize;
    const matchingVectors = vectors.filter((vector) => {
      const normalized = this.normalizeAngle(vector.angle);
      if (normalizedExcluded.some((excluded) => this.angularDistance(normalized, excluded) < 0.36)) {
        return false;
      }

      return this.angularDistance(normalized, targetAngle) < 0.28;
    });

    if (!matchingVectors.length) {
      return null;
    }

    const endpoint = matchingVectors.reduce((best, current) =>
      current.distance > best.distance ? current : best
    ).point;

    return {
      angle: targetAngle,
      endpoint,
    };
  }

  private drawHighlightedMeasureLine(from: CanvasPoint, to: CanvasPoint, color: string): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    context.save();
    context.strokeStyle = color;
    context.lineWidth = Math.max(5, canvas.width * 0.005);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  private renderAngleLabel(vertex: CanvasPoint, angleDegrees: number): void {
    const canvas = this.drawingCanvasRef?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const label = `${angleDegrees.toFixed(1)}°`;
    const fontSize = Math.max(22, canvas.width * 0.026);
    const paddingX = Math.max(10, fontSize * 0.42);
    const paddingY = Math.max(7, fontSize * 0.28);

    context.save();
    context.font = `700 ${fontSize}px Arial`;
    context.textBaseline = 'middle';
    const labelWidth = context.measureText(label).width;
    const boxWidth = labelWidth + (paddingX * 2);
    const boxHeight = fontSize + (paddingY * 2);
    const boxX = Math.min(Math.max(vertex.x + 18, 12), Math.max(canvas.width - boxWidth - 12, 12));
    const boxY = Math.min(Math.max(vertex.y - boxHeight - 18, 12), Math.max(canvas.height - boxHeight - 12, 12));

    context.fillStyle = 'rgba(8, 16, 16, 0.84)';
    context.beginPath();
    context.roundRect(boxX, boxY, boxWidth, boxHeight, 18);
    context.fill();

    context.fillStyle = '#f7faf6';
    context.fillText(label, boxX + paddingX, boxY + (boxHeight / 2));
    context.restore();
  }

  private getSelectionBounds(
    points: CanvasPoint[],
    canvasWidth: number,
    canvasHeight: number
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    return {
      minX: Math.max(0, Math.floor(Math.min(...xs))),
      maxX: Math.min(canvasWidth - 1, Math.ceil(Math.max(...xs))),
      minY: Math.max(0, Math.floor(Math.min(...ys))),
      maxY: Math.min(canvasHeight - 1, Math.ceil(Math.max(...ys))),
    };
  }

  private isPointInPolygon(point: CanvasPoint, polygon: CanvasPoint[]): boolean {
    let isInside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const intersects = ((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
        (point.x < ((polygon[j].x - polygon[i].x) * (point.y - polygon[i].y)) / ((polygon[j].y - polygon[i].y) || 1e-6) + polygon[i].x);

      if (intersects) {
        isInside = !isInside;
      }
    }

    return isInside;
  }

  private isSkeletonOverlayPixel(red: number, green: number, blue: number, alpha: number): boolean {
    return alpha > 120 && green > 150 && blue > 140 && red < 150 && green > red + 30 && blue > red + 20;
  }

  private normalizeAngle(angle: number): number {
    const fullRotation = Math.PI * 2;
    return ((angle % fullRotation) + fullRotation) % fullRotation;
  }

  private angularDistance(first: number, second: number): number {
    const difference = Math.abs(first - second);
    return Math.min(difference, (Math.PI * 2) - difference);
  }

  private angleDifferenceDegrees(first: number, second: number): number {
    const difference = this.angularDistance(first, second);
    return (difference * 180) / Math.PI;
  }

  private async showInfoAlert(header: string, message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK'],
    });

    await alert.present();
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
        if (!blob) {
          reject(new Error('Unable to save drawing.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }
}
