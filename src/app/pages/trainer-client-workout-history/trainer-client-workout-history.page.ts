import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonList,
  IonLabel,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronForwardOutline,
  downloadOutline,
  gridOutline,
} from 'ionicons/icons';
import type {
  WorkoutHistoryDateGroup,
} from '../../models/workout-history.model';
import { WorkoutSummaryService } from '../../services/workout-summary.service';
import { HeaderComponent } from '../../components/header/header.component';

type CsvTableType = 'Strength' | 'Cardio' | 'Other';

@Component({
  selector: 'app-trainer-client-workout-history',
  standalone: true,
  templateUrl: './trainer-client-workout-history.page.html',
  styleUrls: ['./trainer-client-workout-history.page.scss'],
  imports: [
    CommonModule,
    HeaderComponent,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonIcon,
  ],
})
export class TrainerClientWorkoutHistoryPage implements OnInit {
  historyGroups: WorkoutHistoryDateGroup[] = [];
  isLoading = false;
  pageTitle = 'Client Workout History';
  backHref?: string;
  clientId = '';
  clientName = '';
  clientIsDemoMode = false;

  isAuthorized = false;
  accessError = '';

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private route: ActivatedRoute,
    private router: Router,
    private workoutSummaryService: WorkoutSummaryService
  ) {
    addIcons({
      chevronForwardOutline,
      downloadOutline,
      gridOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    this.isLoading = true;
    this.clientId = (this.route.snapshot.paramMap.get('clientId') || '').trim();
    this.clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    this.pageTitle = this.clientName ? `${this.clientName}'s Workout History` : 'Client Workout History';

    try {
      if (!this.clientId) {
        this.accessError = 'No client was selected.';
        return;
      }

      const trainerId = await this.resolveCurrentUserId();
      if (!trainerId) {
        this.accessError = 'You must be signed in to view client workout history.';
        return;
      }

      const allowed = await this.verifyTrainerScope(trainerId, this.clientId);
      if (!allowed) {
        this.accessError = 'You can only view workout history for your assigned clients.';
        return;
      }
      this.isAuthorized = true;

      if (!this.clientName) {
        this.clientName = await this.resolveClientName(this.clientId);
        if (this.clientName) {
          this.pageTitle = `${this.clientName}'s Workout History`;
        }
      }

      this.clientIsDemoMode = await this.resolveClientDemoMode(this.clientId);
      const summaries = await this.workoutSummaryService.listRecentWorkoutSummaries(this.clientId, 30);
      this.historyGroups = summaries.map((summary) => this.workoutSummaryService.toHistoryGroup(summary));
    } catch (error) {
      console.error('[TrainerClientWorkoutHistoryPage] Failed loading history:', error);
      this.accessError = 'Failed to load client workout history.';
      this.historyGroups = [];
    } finally {
      this.isLoading = false;
    }
  }

  openSummary(date: string): void {
    if (!this.clientId) {
      return;
    }
    this.blurActiveElement();

    void this.router.navigate(['/workout-summary'], {
      queryParams: {
        date,
        userId: this.clientId,
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
      state: {
        backHref: `/trainer/client/${this.clientId}/workout-history`,
        backQueryParams: {
          ...(this.clientName ? { clientName: this.clientName } : {}),
        },
      },
    });
  }

  openCsvPage(): void {
    if (!this.clientId) {
      return;
    }
    this.blurActiveElement();

    void this.router.navigate(['/workout-history-csv'], {
      queryParams: {
        userId: this.clientId,
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
      state: {
        historyGroups: this.historyGroups,
      },
    });
  }

  get emptyStateMessage(): string {
    if (this.clientIsDemoMode) {
      return 'This demo client has no workout history yet. Have them log a demo workout first.';
    }

    return 'No workouts saved yet for this client.';
  }

  async exportCsv(): Promise<void> {
    if (this.historyGroups.length === 0) {
      return;
    }

    const sections = [
      this.buildSectionCsv('Strength Table', 'Strength'),
      this.buildSectionCsv('Cardio Table', 'Cardio'),
      this.buildSectionCsv('Other Table', 'Other'),
    ];

    const csv = sections.join('\n\n');
    const filename = this.buildCsvFilename();

    if (!Capacitor.isNativePlatform()) {
      this.downloadCsvOnWeb(csv, filename);
      return;
    }

    try {
      const relativePath = `exports/${filename}`;
      const writeResult = await Filesystem.writeFile({
        path: relativePath,
        data: this.toBase64(csv),
        directory: Directory.Cache,
        recursive: true,
      });

      const fileUri = writeResult.uri || (
        await Filesystem.getUri({
          path: relativePath,
          directory: Directory.Cache,
        })
      ).uri;

      await Share.share({
        title: 'Workout history CSV',
        text: this.clientName
          ? `${this.clientName} workout history`
          : 'Client workout history',
        url: fileUri,
        dialogTitle: 'Share workout history CSV',
      });
    } catch (error) {
      console.error('[TrainerClientWorkoutHistoryPage] Native CSV share failed. Falling back to download.', error);
      this.downloadCsvOnWeb(csv, filename);
    }
  }

  private buildSectionCsv(label: string, type: CsvTableType): string {
    return `${label}\n${this.buildCsvForType(type)}`;
  }

  private buildCsvForType(type: CsvTableType): string {
    const model = this.buildTableModel(type);
    return this.toCsvText(model.header, model.rows);
  }

  private buildTableModel(type: CsvTableType): { header: string[]; rows: string[][] } {
    if (type === 'Strength') {
      return {
        header: ['Date', 'Exercise', 'Sets', 'Reps', 'Weights', 'Calories Burned', 'Trainer Notes'],
        rows: this.buildRowsForType(type),
      };
    }

    if (type === 'Cardio') {
      return {
        header: ['Date', 'Exercise', 'Distance', 'Time', 'Calories Burned', 'Trainer Notes'],
        rows: this.buildRowsForType(type),
      };
    }

    return {
      header: ['Date', 'Exercise', 'Details', 'Calories Burned', 'Trainer Notes'],
      rows: this.buildRowsForType(type),
    };
  }

  private buildRowsForType(type: CsvTableType): string[][] {
    const rows: string[][] = [];

    this.historyGroups.forEach((group) => {
      if (type === 'Strength') {
        group.strength.forEach((entry) => {
          rows.push([
            group.date,
            entry.exercise,
            String(entry.sets),
            String(entry.reps),
            entry.weights,
            String(entry.caloriesBurned),
            group.trainerNotes,
          ]);
        });
        return;
      }

      if (type === 'Cardio') {
        group.cardio.forEach((entry) => {
          rows.push([
            group.date,
            entry.exercise,
            entry.distance,
            entry.time,
            String(entry.caloriesBurned),
            group.trainerNotes,
          ]);
        });
        return;
      }

      group.other.forEach((entry) => {
        rows.push([
          group.date,
          entry.exercise,
          entry.details,
          String(entry.caloriesBurned),
          group.trainerNotes,
        ]);
      });
    });

    return rows;
  }

  private toCsvText(header: string[], rows: string[][]): string {
    const lines = [header.map((cell) => this.csvEscape(cell)).join(',')];
    rows.forEach((row) => {
      lines.push(row.map((cell) => this.csvEscape(cell)).join(','));
    });
    return lines.join('\n');
  }

  private csvEscape(value: string): string {
    const normalized = String(value ?? '');
    if (/[",\n]/.test(normalized)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  }

  private async verifyTrainerScope(trainerId: string, clientId: string): Promise<boolean> {
    const [clientProfileSnap, trainerClientSnap] = await Promise.all([
      getDoc(doc(this.firestore, `clients/${clientId}`)),
      getDoc(doc(this.firestore, `trainers/${trainerId}/clients/${clientId}`)),
    ]);

    const clientData = clientProfileSnap.exists()
      ? (clientProfileSnap.data() as Record<string, unknown>)
      : {};
    const assignedTrainerId = this.readText(clientData['trainerId'] ?? clientData['trainerID']);
    if (assignedTrainerId && assignedTrainerId === trainerId) {
      return true;
    }

    return trainerClientSnap.exists();
  }

  private async resolveClientName(clientId: string): Promise<string> {
    const [userSnap, clientSnap] = await Promise.all([
      getDoc(doc(this.firestore, `users/${clientId}`)),
      getDoc(doc(this.firestore, `clients/${clientId}`)),
    ]);

    const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
    const clientData = clientSnap.exists() ? (clientSnap.data() as Record<string, unknown>) : {};
    const firstName = this.readText(userData['firstName']) || this.readText(clientData['firstName']);
    const lastName = this.readText(userData['lastName']) || this.readText(clientData['lastName']);
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || '';
  }

  private async resolveClientDemoMode(clientId: string): Promise<boolean> {
    try {
      const [clientSnap, userSnap] = await Promise.all([
        getDoc(doc(this.firestore, `clients/${clientId}`)),
        getDoc(doc(this.firestore, `users/${clientId}`)),
      ]);

      const clientData = clientSnap.exists() ? (clientSnap.data() as Record<string, unknown>) : {};
      const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};

      return clientData['demoMode'] === true || userData['demoMode'] === true;
    } catch (error) {
      console.error('[TrainerClientWorkoutHistoryPage] Failed to resolve demo mode:', error);
      return false;
    }
  }

  private async resolveCurrentUserId(): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (currentUser?.uid) {
      return currentUser.uid;
    }

    const authUser = await new Promise<{ uid?: string } | null>((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth as never, (user) => {
        unsubscribe();
        resolve(user);
      });
    });

    return this.readText(authUser?.uid);
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }

  private blurActiveElement(): void {
    const active = globalThis.document?.activeElement;
    if (active instanceof HTMLElement && typeof active.blur === 'function') {
      active.blur();
    }
  }

  private buildCsvFilename(): string {
    const dateTag = new Date().toISOString().slice(0, 10);
    const clientSlug = this.clientName
      ? this.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      : this.clientId;
    return `${clientSlug || 'client'}_workout_history_${dateTag}.csv`;
  }

  private downloadCsvOnWeb(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }
}
