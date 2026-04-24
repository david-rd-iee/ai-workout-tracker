import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonSpinner,
} from '@ionic/angular/standalone';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc } from 'firebase/firestore';
import { UserService } from '../../services/account/user.service';
import { VideoAnalysisViewerComponent } from '../../components/video-analysis-viewer/video-analysis-viewer.component';
import { VideoAnalysisViewerAnalysis, normalizePoseFrames } from '../../components/video-analysis-viewer/video-analysis-viewer.types';
import { HeaderComponent } from 'src/app/components/header/header.component';

@Component({
  selector: 'app-client-analyzed-video',
  standalone: true,
  templateUrl: './client-analyzed-video.page.html',
  styleUrls: ['./client-analyzed-video.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonSpinner,
    HeaderComponent,
    VideoAnalysisViewerComponent,
  ],
})
export class ClientAnalyzedVideoPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(Firestore);
  private readonly userService = inject(UserService);

  isLoading = true;
  errorMessage = '';
  clientId = '';
  trainerId = '';
  analysisId = '';
  analysis: VideoAnalysisViewerAnalysis | null = null;

  async ngOnInit(): Promise<void> {
    this.analysisId = String(this.route.snapshot.paramMap.get('analysisId') || '').trim();
    await this.loadAnalysis();
  }

  private async loadAnalysis(): Promise<void> {
    const currentUser = this.userService.getCurrentUser()();
    this.clientId = String(currentUser?.uid || '').trim();
    if (!this.clientId) {
      this.errorMessage = 'You must be signed in to view this analyzed workout.';
      this.isLoading = false;
      return;
    }

    if (!this.analysisId) {
      this.errorMessage = 'No analyzed workout was selected.';
      this.isLoading = false;
      return;
    }

    try {
      const userSummary = await this.userService.getUserSummaryDirectly(this.clientId);
      this.trainerId = String(userSummary?.trainerId || '').trim();
    } catch {
      this.trainerId = '';
    }

    if (!this.trainerId) {
      this.errorMessage = 'No trainer is assigned to this account yet.';
      this.isLoading = false;
      return;
    }

    try {
      const analysisRef = doc(
        this.firestore,
        `trainers/${this.trainerId}/clients/${this.clientId}/videoAnalysis/${this.analysisId}`
      );
      const snapshot = await getDoc(analysisRef);

      if (!snapshot.exists()) {
        this.errorMessage = 'This analyzed workout could not be found.';
        return;
      }

      const data = snapshot.data() as Record<string, unknown>;
      if (!Boolean(data['canView'])) {
        this.errorMessage = 'This analyzed workout has not been shared with you.';
        return;
      }

      const analysisData = this.asRecord(data['analysis']);
      const video = this.asRecord(data['video']);
      const artifacts = this.asRecord(data['artifacts']);
      const overlayVideo = this.asRecord(artifacts?.['overlayVideo']);
      const inlinePoseAnalysis = analysisData?.['poseAnalysis'] ?? null;
      const inlineBodyLandmarks = analysisData?.['bodyLandmarks'] ?? null;
      let poseFrames = normalizePoseFrames(inlineBodyLandmarks, inlinePoseAnalysis);
      // Attempt lazy fetch when inline pose data was not stored (e.g. large recordings).
      if (!poseFrames.length) {
        const bodyLandmarksArtifact = this.asRecord(artifacts?.['bodyLandmarks']);
        const artifactUrl = typeof bodyLandmarksArtifact?.['downloadUrl'] === 'string'
          ? bodyLandmarksArtifact['downloadUrl'].trim()
          : '';
        if (artifactUrl) {
          try {
            const res = await fetch(artifactUrl);
            if (res.ok) {
              const artifactData: unknown = await res.json();
              poseFrames = normalizePoseFrames(artifactData, null);
            }
          } catch {
            // Non-critical — angle tool will show an unavailable message.
          }
        }
      }
      const analyzedAtIso = typeof analysisData?.['analyzedAtIso'] === 'string'
        ? analysisData['analyzedAtIso'].trim()
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
      const fallbackLabel = analyzedAtIso || String(data['recordedAt'] || '').trim() || snapshot.id;

      this.analysis = {
        id: snapshot.id,
        documentId: snapshot.id,
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
        canView: true,
        publishedToClientAt: this.readFirestoreDateString(data['publishedToClientAt']),
        publishedToClientBy: typeof data['publishedToClientBy'] === 'string'
          ? data['publishedToClientBy'].trim()
          : null,
        notes: this.readNotes(data['notes']),
        drawings: this.readDrawings(data['drawings']),
        poseFrames: poseFrames.length ? poseFrames : undefined,
      };
    } catch (error) {
      console.error('[ClientAnalyzedVideoPage] Failed to load analyzed workout:', error);
      this.errorMessage = 'Unable to load this analyzed workout right now.';
    } finally {
      this.isLoading = false;
    }
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
