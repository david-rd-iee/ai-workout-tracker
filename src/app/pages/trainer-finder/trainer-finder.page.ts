import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, ModalController } from '@ionic/angular/standalone';
import { TrainerCardComponent } from './trainer-card/trainer-card.component';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { TrainerFinderService } from '../../services/trainer-finder.service';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { BehaviorSubject } from 'rxjs';
import { SearchModalComponent } from 'src/app/components/search-modal/search-modal.component';
import { addIcons } from 'ionicons';
import { optionsOutline } from 'ionicons/icons';
import { HeaderComponent } from "../../components/header/header.component";

@Component({
  selector: 'app-trainer-finder',
  templateUrl: './trainer-finder.page.html',
  styleUrls: ['./trainer-finder.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    CommonModule,
    FormsModule,
    TrainerCardComponent,
    HeaderComponent,
],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class TrainerFinderPage implements OnInit {
  trainers: trainerProfile[] = [];
  private pageSize = 20;
  private currentPage = 0;
  searchCriteria = {
    zip: undefined as number | undefined,
    remote: undefined as boolean | undefined,
    inPerson: undefined as boolean | undefined,
    specialization: [] as string[]
  };

  constructor(
    private trainerFinderService: TrainerFinderService,
    private modalCtrl: ModalController
  ) { 
    addIcons({
      optionsOutline 
    });
    this.searchCriteria.inPerson = true;

  }

  ngOnInit() {
    console.log('TrainerFinderPage initialized');
    
    // Subscribe to search results first, then load trainers
    this.trainerFinderService.getSearchResults$().subscribe(results => {
      console.log('Received search results:', results);
      this.trainers = results;
    });
    
    // Initial load of trainers
    this.loadTrainers();
  }

  async loadTrainers(refresh: boolean = false) {
    if (refresh) {
      this.currentPage = 0;
    }

    try {
      // Just call the service method - the subscription will handle updating this.trainers
      await this.trainerFinderService.searchTrainers({
        zip: this.searchCriteria.zip,
        remote: this.searchCriteria.remote,
        inPerson: this.searchCriteria.inPerson,
        specialization: this.searchCriteria.specialization,
        page: this.currentPage,
        pageSize: this.pageSize
      });
      
      // No need to manually update this.trainers here as the subscription handles it
    } catch (error) {
      console.error('Error loading trainers:', error);
    }
  }

  async onSearchChange(event: any) {
    const zip = parseInt(event.detail.value);
    if (!isNaN(zip)) {
      this.searchCriteria.zip = zip;
      await this.loadTrainers(true);
    }
  }

  async onTrainingTypeChange() {
    await this.loadTrainers(true);
  }

  async loadMore(event: any) {
    this.currentPage++;
    await this.loadTrainers();
    event.target.complete();
  }

  async onSlideChange() {
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (error) {
      console.error('Haptic feedback failed:', error);
    }
  }

  async openSearchModal() {
    const modal = await this.modalCtrl.create({
      component: SearchModalComponent,
      componentProps: {
        filters: {
          trainingType: [
            this.searchCriteria.remote ? 'remote' : null,
            this.searchCriteria.inPerson ? 'inPerson' : null
          ].filter(Boolean),
          specialization: this.searchCriteria.specialization
        }
      }
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data) {
      this.searchCriteria.remote = data.trainingType.includes('remote');
      this.searchCriteria.inPerson = data.trainingType.includes('inPerson');
      this.searchCriteria.specialization = data.specialization;
      await this.loadTrainers(true);
    }
  }
}
