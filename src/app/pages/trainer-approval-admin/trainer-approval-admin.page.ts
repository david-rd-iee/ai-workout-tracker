import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonSpinner,
  IonTextarea,
} from '@ionic/angular/standalone';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { UserService } from 'src/app/services/account/user.service';
import { environment } from 'src/environments/environment';

interface PendingTrainerApplication {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  submittedAtLabel: string;
  specialization: string;
  experience: string;
  education: string;
  description: string;
  certifications: string[];
  hourlyRate: number | null;
  city: string;
  state: string;
  phone: string;
}

@Component({
  selector: 'app-trainer-approval-admin',
  standalone: true,
  templateUrl: './trainer-approval-admin.page.html',
  styleUrls: ['./trainer-approval-admin.page.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonSpinner,
    IonTextarea,
    HeaderComponent,
  ],
})
export class TrainerApprovalAdminPage implements OnInit {
  private readonly firestore = inject(Firestore);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  readonly currentUser = this.userService.getUserInfo();
  readonly applications = signal<PendingTrainerApplication[]>([]);
  readonly isLoading = signal(true);
  readonly isAuthorized = signal(false);
  readonly rejectionNotes = signal<Record<string, string>>({});
  readonly actionInFlightUid = signal('');

  readonly hasApplications = computed(() => this.applications().length > 0);

  async ngOnInit(): Promise<void> {
    await this.checkAuthorization();
    if (!this.isAuthorized()) {
      this.isLoading.set(false);
      return;
    }
    await this.loadPendingApplications();
  }

  async refresh(): Promise<void> {
    if (!this.isAuthorized()) {
      return;
    }
    await this.loadPendingApplications();
  }

  updateRejectionNote(uid: string, value: string): void {
    this.rejectionNotes.set({
      ...this.rejectionNotes(),
      [uid]: value,
    });
  }

  async approveApplication(application: PendingTrainerApplication): Promise<void> {
    await this.applyDecision(application, 'approved');
  }

  async rejectApplication(application: PendingTrainerApplication): Promise<void> {
    await this.applyDecision(application, 'rejected');
  }

  private async applyDecision(
    application: PendingTrainerApplication,
    decision: 'approved' | 'rejected'
  ): Promise<void> {
    const reviewerUid = String(this.currentUser()?.id || '').trim();
    if (!application.uid || !reviewerUid) {
      return;
    }

    this.actionInFlightUid.set(application.uid);
    try {
      const note = (this.rejectionNotes()[application.uid] || '').trim();
      await updateDoc(doc(this.firestore, 'users', application.uid), {
        trainerApprovalStatus: decision,
        requestedAccountType: decision === 'approved' ? 'trainer' : 'trainer',
        isPT: decision === 'approved',
        role: decision === 'approved' ? 'trainer' : null,
        trainerReviewedAt: serverTimestamp(),
        trainerReviewedBy: reviewerUid,
        trainerRejectionReason: decision === 'rejected' ? note : null,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(this.firestore, 'trainers', application.uid), {
        approvalStatus: decision,
        visible: decision === 'approved',
        reviewedAt: serverTimestamp(),
        reviewedBy: reviewerUid,
        rejectionReason: decision === 'rejected' ? note : null,
        updatedAt: serverTimestamp(),
      });

      await this.loadPendingApplications();
    } catch (error) {
      console.error(`[TrainerApprovalAdminPage] Failed to ${decision} trainer application:`, error);
    } finally {
      this.actionInFlightUid.set('');
    }
  }

  private async checkAuthorization(): Promise<void> {
    const uid = String(this.currentUser()?.id || '').trim();
    const currentEmail = String(this.currentUser()?.email || '').trim().toLowerCase();
    if (!uid) {
      await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
      return;
    }

    const userSnap = await getDoc(doc(this.firestore, 'users', uid));
    const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
    const role = String(userData['role'] || '').trim().toLowerCase();
    const approvedEmails = (
      (environment as { adminReviewerEmails?: string[] }).adminReviewerEmails || []
    ).map((email: string) => email.trim().toLowerCase());
    const isAuthorized =
      role === 'admin' ||
      (currentEmail.length > 0 && approvedEmails.includes(currentEmail));

    this.isAuthorized.set(isAuthorized);
    if (!isAuthorized) {
      await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    }
  }

  private async loadPendingApplications(): Promise<void> {
    this.isLoading.set(true);
    try {
      const pendingUsersQuery = query(
        collection(this.firestore, 'users'),
        where('requestedAccountType', '==', 'trainer'),
        where('trainerApprovalStatus', '==', 'pending'),
        orderBy('trainerApplicationSubmittedAt', 'desc')
      );
      const pendingUsersSnapshot = await getDocs(pendingUsersQuery);

      const nextApplications = await Promise.all(
        pendingUsersSnapshot.docs.map(async (userDoc) => {
          const userData = userDoc.data() as Record<string, unknown>;
          const trainerSnap = await getDoc(doc(this.firestore, 'trainers', userDoc.id));
          const trainerData = trainerSnap.exists()
            ? (trainerSnap.data() as Record<string, unknown>)
            : {};

          return {
            uid: userDoc.id,
            email: String(userData['email'] || trainerData['email'] || ''),
            firstName: String(userData['firstName'] || trainerData['firstName'] || ''),
            lastName: String(userData['lastName'] || trainerData['lastName'] || ''),
            submittedAtLabel: this.formatDate(userData['trainerApplicationSubmittedAt']),
            specialization: String(trainerData['specialization'] || ''),
            experience: String(trainerData['experience'] || ''),
            education: String(trainerData['education'] || ''),
            description: String(trainerData['description'] || ''),
            certifications: Array.isArray(trainerData['certifications'])
              ? trainerData['certifications'].map((value) => String(value))
              : [],
            hourlyRate:
              typeof trainerData['hourlyRate'] === 'number' ? trainerData['hourlyRate'] : null,
            city: String(trainerData['city'] || ''),
            state: String(trainerData['state'] || ''),
            phone: String(userData['phone'] || trainerData['phone'] || ''),
          } satisfies PendingTrainerApplication;
        })
      );

      this.applications.set(nextApplications);
    } catch (error) {
      console.error('[TrainerApprovalAdminPage] Failed to load pending trainer applications:', error);
      this.applications.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private formatDate(value: unknown): string {
    const maybeTimestamp = value as { toDate?: () => Date };
    const date = maybeTimestamp?.toDate instanceof Function
      ? maybeTimestamp.toDate()
      : new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) {
      return 'Recently submitted';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
}
