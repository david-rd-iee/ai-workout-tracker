import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, getDocs, serverTimestamp, updateDoc } from '@angular/fire/firestore';

export interface TrainerClientVideoAnalysisItem {
  id: string;
  analyzedAtIso: string;
  analyzedAtLabel: string;
  recordedAtLabel: string;
  sortEpochMs: number;
  title: string;
  exercise: string;
  recordingUrl: string;
  overlayUrl: string;
  canView: boolean;
  publishedToClientAt: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class TrainerClientVideoAnalysisService {
  private readonly firestore = inject(Firestore);

  async listClientVideoAnalyses(
    trainerId: string,
    clientId: string
  ): Promise<TrainerClientVideoAnalysisItem[]> {
    const normalizedTrainerId = this.readText(trainerId);
    const normalizedClientId = this.readText(clientId);
    if (!normalizedTrainerId || !normalizedClientId) {
      return [];
    }

    const analysesRef = collection(
      this.firestore,
      `trainers/${normalizedTrainerId}/clients/${normalizedClientId}/videoAnalysis`
    );
    const snapshot = await getDocs(analysesRef);

    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const analysis = this.asRecord(data['analysis']);
        const video = this.asRecord(data['video']);
        const artifacts = this.asRecord(data['artifacts']);
        const overlayVideo = this.asRecord(artifacts?.['overlayVideo']);
        const analyzedAtIso = this.readText(analysis?.['analyzedAtIso']);
        const recordedAtRaw = this.readPossibleDateString(data['recordedAt']);
        const sortDate = this.resolveMostRecentDate(analyzedAtIso, recordedAtRaw);
        const title = this.resolveTitle(data, analysis);
        const exercise = this.resolveExercise(data, analysis);

        return {
          id: docSnap.id,
          analyzedAtIso,
          analyzedAtLabel: this.formatDateLabel(this.parseDate(analyzedAtIso), analyzedAtIso || 'Unknown'),
          recordedAtLabel: this.formatDateLabel(sortDate, analyzedAtIso || recordedAtRaw || 'Unknown'),
          sortEpochMs: sortDate?.getTime() ?? 0,
          title,
          exercise,
          recordingUrl: this.readText(video?.['downloadUrl']),
          overlayUrl: this.readText(overlayVideo?.['downloadUrl']),
          canView: Boolean(data['canView']),
          publishedToClientAt: this.readPossibleDateString(data['publishedToClientAt']) || null,
        } satisfies TrainerClientVideoAnalysisItem;
      })
      .filter((video) => !!video.recordingUrl)
      .sort((left, right) => right.sortEpochMs - left.sortEpochMs);
  }

  async sendAnalysisToClient(trainerId: string, clientId: string, analysisId: string): Promise<void> {
    const normalizedTrainerId = this.readText(trainerId);
    const normalizedClientId = this.readText(clientId);
    const normalizedAnalysisId = this.readText(analysisId);
    if (!normalizedTrainerId || !normalizedClientId || !normalizedAnalysisId) {
      return;
    }

    const analysisRef = doc(
      this.firestore,
      `trainers/${normalizedTrainerId}/clients/${normalizedClientId}/videoAnalysis/${normalizedAnalysisId}`
    );

    await updateDoc(analysisRef, {
      canView: true,
      publishedToClientAt: serverTimestamp(),
      publishedToClientBy: normalizedTrainerId,
      updatedAt: serverTimestamp(),
    });
  }

  private resolveTitle(
    data: Record<string, unknown>,
    analysis: Record<string, unknown> | null
  ): string {
    return this.readText(data['workoutName']) ||
      this.readText(data['title']) ||
      this.readText(analysis?.['workoutName']) ||
      'Workout Video';
  }

  private resolveExercise(
    data: Record<string, unknown>,
    analysis: Record<string, unknown> | null
  ): string {
    const dominantMovement = this.asRecord(analysis?.['dominantMovement']);
    return this.readText(data['exercise']) ||
      this.readText(data['exerciseName']) ||
      this.readText(data['exerciseType']) ||
      this.readText(analysis?.['exercise']) ||
      this.readText(analysis?.['exerciseName']) ||
      this.readText(dominantMovement?.['label']) ||
      '';
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private resolveMostRecentDate(analyzedAtIso: string, recordedAtRaw: string): Date | null {
    const analyzedDate = this.parseDate(analyzedAtIso);
    const recordedDate = this.parseDate(recordedAtRaw);
    if (analyzedDate && recordedDate) {
      return analyzedDate.getTime() >= recordedDate.getTime() ? analyzedDate : recordedDate;
    }
    return analyzedDate || recordedDate;
  }

  private parseDate(value: string): Date | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private readPossibleDateString(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
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

    return '';
  }

  private formatDateLabel(parsedDate: Date | null, fallbackValue: string): string {
    if (!parsedDate) {
      return fallbackValue || 'Unknown date';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsedDate);
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }
}
