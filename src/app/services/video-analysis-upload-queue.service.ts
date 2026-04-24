import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SavedVideoAnalysisRecord, VideoAnalysisResult } from '../models/video-analysis.model';
import { VideoAnalysisService } from './video-analysis.service';

export type VideoAnalysisUploadQueueJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type VideoAnalysisUploadQueueJob = {
  id: string;
  createdAtIso: string;
  recordedAtMs: number;
  clientId: string;
  trainerId: string;
  workoutName: string;
  status: VideoAnalysisUploadQueueJobStatus;
  progressMessage: string;
  errorMessage: string;
  savedRecord: SavedVideoAnalysisRecord | null;
};

type QueueState = {
  jobs: VideoAnalysisUploadQueueJob[];
};

type QueueJobInternal = VideoAnalysisUploadQueueJob & {
  recordedVideo: Blob | null;
  analysis: VideoAnalysisResult | null;
};

@Injectable({ providedIn: 'root' })
export class VideoAnalysisUploadQueueService {
  private readonly videoAnalysisService = inject(VideoAnalysisService);

  private readonly stateSubject = new BehaviorSubject<QueueState>({
    jobs: [],
  });
  readonly state$ = this.stateSubject.asObservable();

  private readonly jobsById = new Map<string, QueueJobInternal>();
  private processing = false;

  enqueueUpload(input: {
    clientId: string;
    trainerId: string;
    recordedAtMs: number;
    recordedVideo: Blob;
    analysis: VideoAnalysisResult;
    workoutName?: string;
  }): string {
    const clientId = String(input.clientId || '').trim();
    const trainerId = String(input.trainerId || '').trim();
    const recordedAtMs = Number(input.recordedAtMs || Date.now());
    const workoutName = String(input.workoutName || '').trim();

    if (!clientId) {
      throw new Error('A client ID is required before queueing an upload.');
    }

    if (!trainerId) {
      throw new Error('A trainer ID is required before queueing an upload.');
    }

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAtIso = new Date().toISOString();

    const nextJob: QueueJobInternal = {
      id: jobId,
      createdAtIso,
      recordedAtMs,
      clientId,
      trainerId,
      workoutName,
      status: 'queued',
      progressMessage: 'Queued for upload.',
      errorMessage: '',
      savedRecord: null,
      recordedVideo: input.recordedVideo,
      analysis: input.analysis,
    };

    this.jobsById.set(jobId, nextJob);
    this.publishState();
    void this.processQueue();
    return jobId;
  }

  clearFinishedJobs(): void {
    const removableIds = Array.from(this.jobsById.values())
      .filter(job => job.status === 'completed' || job.status === 'failed')
      .map(job => job.id);

    removableIds.forEach(id => this.jobsById.delete(id));
    this.publishState();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (true) {
        const nextJob = Array.from(this.jobsById.values()).find(job => job.status === 'queued');
        if (!nextJob) {
          break;
        }

        this.updateJob(nextJob.id, {
          status: 'processing',
          progressMessage: 'Preparing upload...',
          errorMessage: '',
        });

        try {
          if (!nextJob.recordedVideo || !nextJob.analysis) {
            throw new Error('Upload payload is unavailable.');
          }

          const savedRecord = await this.videoAnalysisService.saveAnalysisToTrainer({
            clientId: nextJob.clientId,
            trainerId: nextJob.trainerId,
            recordedAtMs: nextJob.recordedAtMs,
            recordedVideo: nextJob.recordedVideo,
            analysis: nextJob.analysis,
            workoutName: nextJob.workoutName,
            onProgress: (message) => {
              this.updateJob(nextJob.id, {
                progressMessage: message || 'Uploading...',
              });
            },
          });

          this.updateJob(nextJob.id, {
            status: 'completed',
            progressMessage: 'Upload complete.',
            savedRecord,
          });
          this.releaseJobPayload(nextJob.id);
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : 'Upload failed.';
          this.updateJob(nextJob.id, {
            status: 'failed',
            progressMessage: '',
            errorMessage: message,
          });
          this.releaseJobPayload(nextJob.id);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private releaseJobPayload(id: string): void {
    const existing = this.jobsById.get(id);
    if (!existing) {
      return;
    }

    this.jobsById.set(id, {
      ...existing,
      recordedVideo: null,
      analysis: null,
    });
  }

  private updateJob(
    id: string,
    patch: Partial<Omit<QueueJobInternal, 'id' | 'recordedVideo' | 'analysis'>>
  ): void {
    const existing = this.jobsById.get(id);
    if (!existing) {
      return;
    }

    this.jobsById.set(id, {
      ...existing,
      ...patch,
    });
    this.publishState();
  }

  private publishState(): void {
    const jobs = Array.from(this.jobsById.values())
      .map((job) => {
        const publicJob: VideoAnalysisUploadQueueJob = {
          id: job.id,
          createdAtIso: job.createdAtIso,
          recordedAtMs: job.recordedAtMs,
          clientId: job.clientId,
          trainerId: job.trainerId,
          workoutName: job.workoutName,
          status: job.status,
          progressMessage: job.progressMessage,
          errorMessage: job.errorMessage,
          savedRecord: job.savedRecord,
        };
        return publicJob;
      })
      .sort((left, right) => {
        const leftTime = Number(new Date(left.createdAtIso).getTime());
        const rightTime = Number(new Date(right.createdAtIso).getTime());
        return rightTime - leftTime;
      });

    this.stateSubject.next({ jobs });
  }
}
