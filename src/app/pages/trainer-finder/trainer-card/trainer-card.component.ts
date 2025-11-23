import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, Input } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon, IonCard, IonCardHeader, IonCardContent, IonCardTitle, IonButton } from '@ionic/angular';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { addIcons } from 'ionicons';
import { locationOutline, cashOutline, fitnessOutline, checkmarkCircle } from 'ionicons/icons';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { TrainerFinderService } from 'src/app/services/trainer-finder.service';
import { TruncatePipe } from 'src/app/pipes/truncate.pipe';

@Component({
  selector: 'app-trainer-card',
  templateUrl: './trainer-card.component.html',
  styleUrls: ['./trainer-card.component.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardContent,
    IonCardTitle,
    IonButton,
    TruncatePipe
  ]
})
export class TrainerCardComponent implements OnInit {
  @Input() trainer!: trainerProfile;
  
  get specializations(): string[] {
    // Ensure specialization is always treated as an array
    if (!this.trainer.specialization) return [];
    return Array.isArray(this.trainer.specialization) 
      ? this.trainer.specialization 
      : [this.trainer.specialization as string];
  }

  constructor
  ( 
    private router: Router,
    private trainerFinderService: TrainerFinderService
  ) { 
    addIcons({
      locationOutline,
      cashOutline,
      fitnessOutline,
      checkmarkCircle
    });
  }

  ngOnInit() {
    // Validate trainer data
    if (!this.trainer) {
      console.error('No trainer data provided to TrainerCardComponent');
    }
  }

  goToTrainerProfile(trainerId: string) {
    this.trainerFinderService.setChosenTrainer(this.trainer);
    this.router.navigate([ROUTE_PATHS.APP.TABS.INFO, trainerId]);
  }


}
