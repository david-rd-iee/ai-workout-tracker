import { Component, OnInit, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonSpinner, ToastController } from '@ionic/angular/standalone';
import { HeaderComponent } from '../../../components/header/header.component';
import { AvailabiltyComponent } from '../../../components/availabilty/availabilty.component';
import { DayAvailability } from '../../../Interfaces/Availability';
import { TrainerAvailabilityService } from '../../../services/trainer-availability.service';
import { UserService } from '../../../services/account/user.service';

@Component({
  selector: 'app-trainer-availability-page',
  standalone: true,
  templateUrl: './trainer-availability.page.html',
  styleUrls: ['./trainer-availability.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButton,
    IonSpinner,
    HeaderComponent,
    AvailabiltyComponent,
  ],
})
export class TrainerAvailabilityPage implements OnInit {
  trainerId = '';
  weeklyAvailability: DayAvailability[] = [];
  availabilityLoaded = signal<boolean>(false);
  isSavingAvailability = signal<boolean>(false);
  availabilityDirty = false;

  constructor(
    private userService: UserService,
    private trainerAvailabilityService: TrainerAvailabilityService,
    private toastController: ToastController,
  ) {
    effect(() => {
      const user = this.userService.getCurrentUser()();
      if (!user) {
        this.trainerId = '';
        this.weeklyAvailability = [];
        this.availabilityLoaded.set(false);
        return;
      }

      const nextTrainerId = String(user.uid || '').trim();
      if (!nextTrainerId) {
        return;
      }

      const didTrainerChange = this.trainerId !== nextTrainerId;
      this.trainerId = nextTrainerId;

      if (didTrainerChange || !this.availabilityLoaded()) {
        void this.loadWeeklyAvailability();
      }
    });
  }

  ngOnInit(): void {
    if (this.trainerId && !this.availabilityLoaded()) {
      void this.loadWeeklyAvailability();
    }
  }

  onAvailabilityChanged(nextAvailability: DayAvailability[]): void {
    this.weeklyAvailability = nextAvailability.map((day) => ({
      ...day,
      timeWindows: Array.isArray(day.timeWindows)
        ? day.timeWindows.map((window) => ({ ...window }))
        : [],
    }));
    this.availabilityDirty = true;
  }

  async saveAvailability(): Promise<void> {
    if (!this.trainerId || !this.weeklyAvailability.length) {
      await this.showToast('No trainer availability is ready to save yet.', 'warning');
      return;
    }

    this.isSavingAvailability.set(true);
    try {
      await this.trainerAvailabilityService.saveTrainerWeeklyAvailabilityEverywhere(
        this.trainerId,
        this.weeklyAvailability,
      );
      this.availabilityDirty = false;
      await this.showToast('Weekly availability updated.', 'success');
    } catch (error) {
      console.error('Error saving trainer availability:', error);
      await this.showToast('Failed to save availability. Please try again.', 'danger');
    } finally {
      this.isSavingAvailability.set(false);
    }
  }

  private async loadWeeklyAvailability(): Promise<void> {
    if (!this.trainerId) {
      return;
    }

    this.availabilityLoaded.set(false);
    try {
      const availability = await this.trainerAvailabilityService.getTrainerWeeklyAvailability(this.trainerId);
      this.weeklyAvailability = availability.map((day) => ({
        ...day,
        timeWindows: Array.isArray(day.timeWindows)
          ? day.timeWindows.map((window) => ({ ...window }))
          : [],
      }));
      this.availabilityDirty = false;
      this.availabilityLoaded.set(true);
    } catch (error) {
      console.error('Error loading trainer availability:', error);
      this.availabilityLoaded.set(false);
      await this.showToast('Unable to load your weekly availability right now.', 'warning');
    }
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await toast.present();
  }
}
