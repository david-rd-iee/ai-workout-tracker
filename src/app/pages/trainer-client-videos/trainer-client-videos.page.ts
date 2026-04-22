import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonIcon, IonSpinner, NavController } from '@ionic/angular/standalone';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { AccountService } from '../../services/account/account.service';
import { addIcons } from 'ionicons';
import { analyticsOutline, chevronForwardOutline } from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';

type TrainerClientVideoItem = {
  id: string;
  workoutName: string;
  recordedAtLabel: string;
  sortEpochMs: number;
};

@Component({
  selector: 'app-trainer-client-videos',
  standalone: true,
  templateUrl: './trainer-client-videos.page.html',
  styleUrls: ['./trainer-client-videos.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class TrainerClientVideosPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(Firestore);
  private readonly accountService = inject(AccountService);
  private readonly navCtrl = inject(NavController);

  isLoading = true;
  errorMessage = '';
  clientId = '';
  clientName = '';
  videos: TrainerClientVideoItem[] = [];

  constructor() {
    addIcons({
      analyticsOutline,
      chevronForwardOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.clientId = String(this.route.snapshot.paramMap.get('clientId') || '').trim();
    this.clientName = String(this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    await this.loadClientVideos();
  }

  openVideo(video: TrainerClientVideoItem): void {
    if (!this.clientId) {
      return;
    }

    this.navCtrl.navigateForward(`/trainer-workout-analyzer/${this.clientId}`, {
      animated: true,
      animationDirection: 'forward',
      replaceUrl: true,
      queryParams: {
        clientName: this.clientName,
        analysisId: video.id,
      },
    });
  }

  private async loadClientVideos(): Promise<void> {
    const trainerId = String(this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId) {
      this.errorMessage = 'You must be signed in to view analyzed videos.';
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

      this.videos = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const analysis = this.asRecord(data['analysis']);
          const video = this.asRecord(data['video']);
          const analyzedAtIso = typeof analysis?.['analyzedAtIso'] === 'string'
            ? analysis['analyzedAtIso'].trim()
            : '';
          const workoutName = typeof data['workoutName'] === 'string'
            ? data['workoutName'].trim()
            : '';
          const recordingUrl = typeof video?.['downloadUrl'] === 'string'
            ? video['downloadUrl'].trim()
            : '';
          const recordedAtRaw = this.readPossibleDateString(data['recordedAt']);
          const sortDate = this.resolveMostRecentDate(analyzedAtIso, recordedAtRaw);

          return {
            id: docSnap.id,
            workoutName: workoutName || 'Workout Video',
            hasRecording: !!recordingUrl,
            sortEpochMs: sortDate?.getTime() ?? 0,
            recordedAtLabel: this.formatDateLabel(sortDate, analyzedAtIso || recordedAtRaw),
          };
        })
        .filter((video) => video.hasRecording)
        .sort((left, right) => right.sortEpochMs - left.sortEpochMs);
    } catch (error) {
      console.error('[TrainerClientVideosPage] Failed to load client videos:', error);
      this.errorMessage = 'Unable to load analyzed videos right now.';
    } finally {
      this.isLoading = false;
    }
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
}
