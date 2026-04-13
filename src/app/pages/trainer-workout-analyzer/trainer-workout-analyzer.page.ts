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
  IonMenuToggle,
  IonMenuButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { AccountService } from '../../services/account/account.service';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';

type WorkoutAnalysisMenuItem = {
  id: string;
  label: string;
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
  workoutAnalyses: WorkoutAnalysisMenuItem[] = [];

  constructor() {
    addIcons({
      arrowBackOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.clientId = String(this.route.snapshot.paramMap.get('clientId') || '').trim();
    this.clientName = String(this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    await this.loadWorkoutAnalyses();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/client-workout-analysis', {
      animated: true,
      animationDirection: 'back',
    });
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
          const analyzedAtIso = typeof analysis?.['analyzedAtIso'] === 'string'
            ? analysis['analyzedAtIso'].trim()
            : '';
          const workoutName = typeof data['workoutName'] === 'string'
            ? data['workoutName'].trim()
            : '';
          const fallbackLabel = analyzedAtIso || String(data['recordedAt'] || '').trim() || docSnap.id;

          return {
            id: docSnap.id,
            label: workoutName ? `${fallbackLabel}:${workoutName}` : fallbackLabel,
            analyzedAtIso: fallbackLabel,
          };
        })
        .sort((left, right) => right.analyzedAtIso.localeCompare(left.analyzedAtIso))
        .map(({ id, label }) => ({ id, label }));
    } catch (error) {
      console.error('[TrainerWorkoutAnalyzerPage] Failed to load workout analyses:', error);
      this.errorMessage = 'Unable to load workout analyses right now.';
    } finally {
      this.isLoading = false;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }
}
