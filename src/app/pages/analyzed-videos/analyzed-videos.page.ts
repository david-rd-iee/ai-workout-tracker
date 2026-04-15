import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonSpinner,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs } from 'firebase/firestore';
import { UserService } from '../../services/account/user.service';

type ClientAnalyzedVideoItem = {
  id: string;
  analyzedAtIso: string;
  recordedAt: string;
  label: string;
};

@Component({
  selector: 'app-analyzed-videos',
  standalone: true,
  templateUrl: './analyzed-videos.page.html',
  styleUrls: ['./analyzed-videos.page.scss'],
  imports: [
    CommonModule,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
})
export class AnalyzedVideosPage implements OnInit {
  private readonly firestore = inject(Firestore);
  private readonly userService = inject(UserService);
  private readonly navCtrl = inject(NavController);

  isLoading = true;
  errorMessage = '';
  analyzedVideos: ClientAnalyzedVideoItem[] = [];

  async ngOnInit(): Promise<void> {
    await this.loadAnalyzedVideos();
  }

  openAnalysis(video: ClientAnalyzedVideoItem): void {
    this.navCtrl.navigateForward(`/client-analyzed-video/${video.id}`);
  }

  private async loadAnalyzedVideos(): Promise<void> {
    const currentUser = this.userService.getCurrentUser()();
    const clientId = String(currentUser?.uid || '').trim();
    if (!clientId) {
      this.errorMessage = 'You must be signed in to view analyzed workouts.';
      this.isLoading = false;
      return;
    }

    let trainerId = '';

    try {
      const userSummary = await this.userService.getUserSummaryDirectly(clientId);
      trainerId = String(userSummary?.trainerId || '').trim();
    } catch {
      trainerId = '';
    }

    if (!trainerId) {
      this.errorMessage = 'No trainer is assigned to this account yet.';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const analysesRef = collection(
        this.firestore,
        `trainers/${trainerId}/clients/${clientId}/videoAnalysis`
      );
      const snapshot = await getDocs(analysesRef);

      this.analyzedVideos = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const analysis = this.asRecord(data['analysis']);
          const analyzedAtIso = typeof analysis?.['analyzedAtIso'] === 'string'
            ? analysis['analyzedAtIso'].trim()
            : '';
          const recordedAt = typeof data['recordedAt'] === 'string'
            ? data['recordedAt'].trim()
            : '';
          const canView = Boolean(data['canView']);
          const sortValue = analyzedAtIso || recordedAt;

          return {
            id: docSnap.id,
            analyzedAtIso,
            recordedAt,
            canView,
            sortValue,
            label: this.formatAnalysisDate(sortValue),
          };
        })
        .filter((item) => item.canView)
        .sort((left, right) => right.sortValue.localeCompare(left.sortValue))
        .map(({ id, analyzedAtIso, recordedAt, label }) => ({
          id,
          analyzedAtIso,
          recordedAt,
          label,
        }));
    } catch (error) {
      console.error('[AnalyzedVideosPage] Failed to load analyzed workouts:', error);
      this.errorMessage = 'Unable to load analyzed workouts right now.';
    } finally {
      this.isLoading = false;
    }
  }

  private formatAnalysisDate(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Unknown analysis date';
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
}
