import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
} from '@ionic/angular/standalone';
import { AccountService } from '../../services/account/account.service';
import { UserService } from '../../services/account/user.service';

const FITNESS_LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
const GOALS = ['Strength', 'Cardio', 'Consistency', 'General Fitness'] as const;

type DemoFitnessLevel = (typeof FITNESS_LEVELS)[number];
type DemoGoal = (typeof GOALS)[number];

@Component({
  selector: 'app-demo-setup',
  standalone: true,
  templateUrl: './demo-setup.page.html',
  styleUrls: ['../login/login.page.scss', './demo-setup.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonInput,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonButton,
    IonSpinner,
    IonText,
  ],
})
export class DemoSetupPage {
  displayName = '';
  fitnessLevel: DemoFitnessLevel | '' = 'Beginner';
  goal: DemoGoal | '' = 'General Fitness';
  isSubmitting = false;
  errorMessage = '';

  readonly fitnessLevelOptions = FITNESS_LEVELS;
  readonly goalOptions = GOALS;

  constructor(
    private accountService: AccountService,
    private userService: UserService,
    private router: Router
  ) {}

  async startDemo(): Promise<void> {
    this.errorMessage = '';

    const displayName = this.displayName.trim();
    if (!displayName) {
      this.errorMessage = 'Please add a display name or nickname.';
      return;
    }

    if (!this.fitnessLevel || !this.goal) {
      this.errorMessage = 'Please choose a fitness level and goal.';
      return;
    }

    this.isSubmitting = true;
    this.accountService.beginDemoSetup();
    try {
      const uid = await this.accountService.signInAnonymously();
      if (!uid) {
        this.errorMessage =
          this.accountService.getLastAuthErrorMessage() || 'Unable to start demo mode right now.';
        return;
      }

      const created = await this.userService.createDemoClientProfile({
        displayName,
        fitnessLevel: this.fitnessLevel,
        goal: this.goal,
      });

      if (!created) {
        this.errorMessage = 'Unable to create the demo profile right now.';
        return;
      }

      await this.userService.loadUserProfile();
      await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    } catch (error) {
      console.error('[DemoSetupPage] Failed to start demo mode:', error);
      this.errorMessage = 'Something went wrong while creating your demo profile.';
    } finally {
      this.isSubmitting = false;
      this.accountService.endDemoSetup();
    }
  }
}
