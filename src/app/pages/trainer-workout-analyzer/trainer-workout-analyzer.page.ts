import { AfterViewChecked, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
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
  notesOpen = false;
  drawingsOpen = false;
  isDrawingMode = false;
  isSavingDrawing = false;
  selectedDrawingImageUrl = '';
  hasDrawingInk = false;
  drawingTimestampSeconds = 0;
  drawMode: 'freehand' | 'line' = 'freehand';

  private pendingVideoSelectionSync = false;
  private drawing = false;
  private lastDrawPoint: { x: number; y: number } | null = null;
  private lineStartPoint: { x: number; y: number } | null = null;
  private lineSnapshot: ImageData | null = null;

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

  get hasNotes(): boolean {
    return (this.selectedAnalysis?.notes.length ?? 0) > 0;
  }

  get hasDrawings(): boolean {
    return (this.selectedAnalysis?.drawings.length ?? 0) > 0;
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
    this.notesOpen = false;
    this.drawingsOpen = false;
    this.isDrawingMode = false;
    this.selectedDrawingImageUrl = '';
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = 0;
    this.drawMode = 'freehand';
    this.pendingVideoSelectionSync = true;
  }

  toggleTools(): void {
    if (this.isDrawingMode) {
      return;
    }

    this.toolsOpen = !this.toolsOpen;
  }

  openNotes(): void {
    if (!this.hasNotes) {
      return;
    }

    this.toolsOpen = false;
    this.notesOpen = true;
  }

  closeNotes(): void {
    this.notesOpen = false;
  }

  openDrawings(): void {
    if (!this.hasDrawings) {
      return;
    }

    this.toolsOpen = false;
    this.drawingsOpen = true;
  }

  closeDrawings(): void {
    this.drawingsOpen = false;
  }

  openDrawingImage(imageUrl: string): void {
    this.selectedDrawingImageUrl = imageUrl;
  }

  closeDrawingImage(): void {
    this.selectedDrawingImageUrl = '';
  }

  setDrawMode(mode: 'freehand' | 'line'): void {
    if (!this.isDrawingMode) {
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
    this.notesOpen = false;
    this.drawingsOpen = false;
    this.selectedDrawingImageUrl = '';
    this.isDrawingMode = true;
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = Number.isFinite(activeVideo.currentTime) ? activeVideo.currentTime : this.currentTimeSeconds;
    this.drawMode = 'freehand';
    this.resetDrawingGestureState();
    this.pendingVideoSelectionSync = true;
  }

  cancelDrawingMode(): void {
    this.isDrawingMode = false;
    this.hasDrawingInk = false;
    this.drawingTimestampSeconds = 0;
    this.resetDrawingGestureState();
  }

  async saveDrawing(): Promise<void> {
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

  async jumpToNote(note: WorkoutAnalysisNote): Promise<void> {
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    this.notesOpen = false;
    await this.waitForMetadata(activeVideo).catch(() => undefined);
    const safeTime = Math.max(
      0,
      Math.min(note.timestampSeconds, Math.max((activeVideo.duration || note.timestampSeconds) - 0.05, 0))
    );
    activeVideo.currentTime = safeTime;
    this.currentTimeSeconds = safeTime;
    await activeVideo.play().catch(() => undefined);
  }

  async jumpToDrawing(drawing: WorkoutAnalysisDrawing): Promise<void> {
    const activeVideo = this.getVideoElement(this.videoMode);
    if (!activeVideo) {
      return;
    }

    this.drawingsOpen = false;
    await this.waitForMetadata(activeVideo).catch(() => undefined);
    const safeTime = Math.max(
      0,
      Math.min(drawing.timestampSeconds, Math.max((activeVideo.duration || drawing.timestampSeconds) - 0.05, 0))
    );
    activeVideo.currentTime = safeTime;
    this.currentTimeSeconds = safeTime;
    await activeVideo.play().catch(() => undefined);
  }

  noteTimestampLabel(note: WorkoutAnalysisNote): string {
    return `${this.formatTime(note.timestampSeconds)}:${note.note}`;
  }

  drawingTimestampLabel(drawing: WorkoutAnalysisDrawing): string {
    return this.formatTime(drawing.timestampSeconds);
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
    if (!canvas || !this.lastDrawPoint) {
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
            recordingUrl,
            overlayUrl,
            notes: this.readNotes(data['notes']),
            drawings: this.readDrawings(data['drawings']),
          };
        })
        .filter((analysis) => !!analysis.recordingUrl)
        .sort((left, right) => right.analyzedAtIso.localeCompare(left.analyzedAtIso))
        .map(({ id, label, recordingUrl, overlayUrl, notes, drawings }) => ({
          id,
          label,
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
        if (!Number.isFinite(timestampSeconds) || !imageUrl) {
          return null;
        }

        return {
          timestampSeconds,
          imageUrl,
          storagePath,
          createdAtIso,
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private getCanvasPoint(
    canvas: HTMLCanvasElement,
    event: PointerEvent
  ): { x: number; y: number } {
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
