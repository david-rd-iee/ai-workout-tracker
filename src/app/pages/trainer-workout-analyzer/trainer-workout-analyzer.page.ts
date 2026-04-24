import { Component, OnInit, inject } from '@angular/core';
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
import { Firestore } from '@angular/fire/firestore';
import { collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { AccountService } from '../../services/account/account.service';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { VideoAnalysisViewerComponent } from '../../components/video-analysis-viewer/video-analysis-viewer.component';
import { VideoAnalysisViewerAnalysis, normalizePoseFrames } from '../../components/video-analysis-viewer/video-analysis-viewer.types';
import { VideoAnalysisFrame } from '../../models/video-analysis.model';

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
    VideoAnalysisViewerComponent,
  ],
})
export class TrainerWorkoutAnalyzerPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountService = inject(AccountService);
  private readonly firestore = inject(Firestore);
  private readonly navCtrl = inject(NavController);

  readonly contentId = 'trainer-workout-analyzer-content';

  isLoading = true;
  errorMessage = '';
  clientId = '';
  clientName = '';
  analysisId = '';
  workoutAnalyses: VideoAnalysisViewerAnalysis[] = [];
  selectedAnalysis: VideoAnalysisViewerAnalysis | null = null;
  isPublishingToClient = false;

  constructor() {
    addIcons({ arrowBackOutline });
  }

  async ngOnInit(): Promise<void> {
    this.clientId = String(this.route.snapshot.paramMap.get('clientId') || '').trim();
    this.clientName = String(this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    this.analysisId = String(this.route.snapshot.queryParamMap.get('analysisId') || '').trim();
    await this.loadWorkoutAnalyses();
  }

  goBack(): void {
    const fallbackRoute = this.clientId ? `/trainer-client-videos/${this.clientId}` : '/tabs/home';
    this.navCtrl.navigateBack(fallbackRoute, {
      animated: true,
      animationDirection: 'back',
      queryParams: this.clientName ? { clientName: this.clientName } : undefined,
    });
  }

  get canSendToClient(): boolean {
    return !!this.selectedAnalysis && !this.selectedAnalysis.canView && !this.isPublishingToClient;
  }

  get isSelectedAnalysisReadOnly(): boolean {
    return !!this.selectedAnalysis?.canView;
  }

  get sendToClientLabel(): string {
    if (this.isPublishingToClient) {
      return 'Sending...';
    }

    return this.selectedAnalysis?.canView ? 'Sent to Client' : 'Send to Client';
  }

  get trainerUid(): string {
    return String(this.accountService.getCredentials()().uid || '').trim();
  }

  async selectAnalysis(analysis: VideoAnalysisViewerAnalysis): Promise<void> {
    let resolved = analysis;

    // Lazy-load pose frames from the artifact URL when inline data was not stored.
    if (!resolved.poseFrames?.length && resolved.poseArtifactUrl) {
      try {
        const frames = await this.loadPoseFramesFromUrl(resolved.poseArtifactUrl);
        resolved = { ...resolved, poseFrames: frames.length ? frames : undefined, poseArtifactUrl: undefined };
        // Persist the loaded frames into the cached list so re-selection is instant.
        this.workoutAnalyses = this.workoutAnalyses.map(a =>
          a.id === resolved.id ? resolved : a
        );
      } catch {
        // Non-critical — angle tool will show an unavailable message.
      }
    }

    this.selectedAnalysis = {
      ...resolved,
      notes: [...resolved.notes],
      drawings: [...resolved.drawings],
    };
  }

  handleAnalysisChange(updatedAnalysis: VideoAnalysisViewerAnalysis): void {
    this.workoutAnalyses = this.workoutAnalyses.map((item) =>
      item.id === updatedAnalysis.id ? updatedAnalysis : item
    );

    if (this.selectedAnalysis?.id === updatedAnalysis.id) {
      this.selectedAnalysis = updatedAnalysis;
    }
  }

  async sendAnalysisToClient(): Promise<void> {
    const analysis = this.selectedAnalysis;
    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!analysis || !this.clientId || !trainerId || this.isPublishingToClient || analysis.canView) {
      return;
    }

    this.isPublishingToClient = true;

    try {
      const analysisRef = doc(
        this.firestore,
        `trainers/${trainerId}/clients/${this.clientId}/videoAnalysis/${analysis.id}`
      );

      await updateDoc(analysisRef, {
        canView: true,
        publishedToClientAt: serverTimestamp(),
        publishedToClientBy: trainerId,
      });

      const nextAnalysis: VideoAnalysisViewerAnalysis = {
        ...analysis,
        canView: true,
        publishedToClientAt: new Date().toISOString(),
        publishedToClientBy: trainerId,
      };

      this.handleAnalysisChange(nextAnalysis);
    } finally {
      this.isPublishingToClient = false;
    }
  }

  formatSavedAnalysisLabel(analysis: VideoAnalysisViewerAnalysis): string {
    const formattedDate = this.formatAnalysisDate(analysis.analyzedAtIso);
    return analysis.workoutName ? `${formattedDate} : ${analysis.workoutName}` : formattedDate;
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
          const recordingMimeType = typeof video?.['mimeType'] === 'string'
            ? video['mimeType'].trim()
            : '';
          const overlayUrl = typeof overlayVideo?.['downloadUrl'] === 'string'
            ? overlayVideo['downloadUrl'].trim()
            : '';
          const overlayMimeType = typeof overlayVideo?.['mimeType'] === 'string'
            ? overlayVideo['mimeType'].trim()
            : '';
          const fallbackLabel = analyzedAtIso || String(data['recordedAt'] || '').trim() || docSnap.id;

          const inlinePoseAnalysis = analysis?.['poseAnalysis'] ?? null;
          const inlineBodyLandmarks = analysis?.['bodyLandmarks'] ?? null;
          const poseFrames = normalizePoseFrames(inlineBodyLandmarks, inlinePoseAnalysis);
          const bodyLandmarksArtifact = this.asRecord(this.asRecord(data['artifacts'])?.['bodyLandmarks']);
          const poseArtifactUrl =
            !poseFrames.length && typeof bodyLandmarksArtifact?.['downloadUrl'] === 'string'
              ? bodyLandmarksArtifact['downloadUrl'].trim()
              : undefined;

          return {
            id: docSnap.id,
            documentId: docSnap.id,
            label: workoutName ? `${fallbackLabel}:${workoutName}` : fallbackLabel,
            analyzedAtIso: fallbackLabel,
            workoutName,
            recordingUrl,
            recordingMimeType,
            overlayUrl,
            overlayMimeType,
            videoStoragePath: typeof video?.['storagePath'] === 'string' ? video['storagePath'].trim() : '',
            videoDownloadUrl: recordingUrl,
            overlayVideoStoragePath:
              typeof overlayVideo?.['storagePath'] === 'string' ? overlayVideo['storagePath'].trim() : undefined,
            overlayVideoDownloadUrl: overlayUrl || undefined,
            canView: Boolean(data['canView']),
            publishedToClientAt: this.readFirestoreDateString(data['publishedToClientAt']),
            publishedToClientBy: typeof data['publishedToClientBy'] === 'string'
              ? data['publishedToClientBy'].trim()
              : null,
            notes: this.readNotes(data['notes']),
            drawings: this.readDrawings(data['drawings']),
            poseFrames: poseFrames.length ? poseFrames : undefined,
            poseArtifactUrl,
          } satisfies VideoAnalysisViewerAnalysis;
        })
        .filter((analysis) => !!analysis.recordingUrl)
        .sort((left, right) => right.analyzedAtIso.localeCompare(left.analyzedAtIso));

      const initiallySelectedAnalysis = this.analysisId
        ? this.workoutAnalyses.find((analysis) => analysis.id === this.analysisId) ?? null
        : null;

      this.selectedAnalysis = initiallySelectedAnalysis || this.workoutAnalyses[0] || null;
    } catch (error) {
      console.error('[TrainerWorkoutAnalyzerPage] Failed to load workout analyses:', error);
      this.errorMessage = 'Unable to load workout analyses right now.';
    } finally {
      this.isLoading = false;
    }
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

  private readFirestoreDateString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || null;
    }

    if (value && typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
      const toDate = (value as { toDate?: () => Date }).toDate;
      if (typeof toDate === 'function') {
        const date = toDate.call(value);
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    return null;
  }

  private readNotes(value: unknown): VideoAnalysisViewerAnalysis['notes'] {
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

        return { timestampSeconds, note: noteText, createdAtIso };
      })
      .filter((note): note is VideoAnalysisViewerAnalysis['notes'][number] => note !== null)
      .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
  }

  private async loadPoseFramesFromUrl(url: string): Promise<VideoAnalysisFrame[]> {
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data: unknown = await response.json();
    // The body-landmarks artifact stores a plain VideoAnalysisFrame[] in the legacy format.
    return normalizePoseFrames(data, null);
  }

  private readDrawings(value: unknown): VideoAnalysisViewerAnalysis['drawings'] {
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

        return { timestampSeconds, imageUrl, storagePath, createdAtIso, note };
      })
      .filter((drawing): drawing is VideoAnalysisViewerAnalysis['drawings'][number] => drawing !== null)
      .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
  }
}
