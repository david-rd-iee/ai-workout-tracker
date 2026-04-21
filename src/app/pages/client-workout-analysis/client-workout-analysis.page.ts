import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonIcon,
  IonSpinner,
  NavController,
} from '@ionic/angular/standalone';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { AccountService } from '../../services/account/account.service';
import { addIcons } from 'ionicons';
import { analyticsOutline, chevronForwardOutline } from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';

type ClientWorkoutAnalysisListItem = {
  id: string;
  clientName: string;
};

@Component({
  selector: 'app-client-workout-analysis',
  standalone: true,
  templateUrl: './client-workout-analysis.page.html',
  styleUrls: ['./client-workout-analysis.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class ClientWorkoutAnalysisPage implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly firestore = inject(Firestore);
  private readonly navCtrl = inject(NavController);

  isLoading = true;
  errorMessage = '';
  clients: ClientWorkoutAnalysisListItem[] = [];

  constructor() {
    addIcons({
      analyticsOutline,
      chevronForwardOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    await this.loadClients();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
  }

  openClient(client: ClientWorkoutAnalysisListItem): void {
    this.navCtrl.navigateForward(`/trainer-client-videos/${client.id}`, {
      animated: true,
      animationDirection: 'forward',
      queryParams: {
        clientName: client.clientName,
      },
    });
  }

  private async loadClients(): Promise<void> {
    const trainerId = (this.accountService.getCredentials()().uid || '').trim();
    if (!trainerId) {
      this.errorMessage = 'You must be signed in to view clients.';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const clientsRef = collection(this.firestore, `trainers/${trainerId}/clients`);
      const snapshot = await getDocs(clientsRef);

      this.clients = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const rawClientName = typeof data['clientName'] === 'string' ? data['clientName'].trim() : '';
          const firstName = typeof data['firstName'] === 'string' ? data['firstName'].trim() : '';
          const lastName = typeof data['lastName'] === 'string' ? data['lastName'].trim() : '';
          const fallbackName = `${firstName} ${lastName}`.trim();

          return {
            id: docSnap.id,
            clientName: rawClientName || fallbackName || 'Unnamed client',
          };
        })
        .sort((left, right) => left.clientName.localeCompare(right.clientName));
    } catch (error) {
      console.error('[ClientWorkoutAnalysisPage] Failed to load trainer clients:', error);
      this.errorMessage = 'Unable to load clients right now.';
    } finally {
      this.isLoading = false;
    }
  }
}
