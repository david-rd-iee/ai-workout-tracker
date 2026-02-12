import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { 
  IonModal, 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonContent, 
  IonButton, 
  IonButtons, 
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
  IonReorder,
  IonReorderGroup,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, save, reorderThree } from 'ionicons/icons';

interface Widget {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
}

interface HomePageConfig {
  clientId: string;
  widgets: Widget[];
  customMessage?: string;
}

@Component({
  selector: 'app-home-customization-modal',
  standalone: true,
  templateUrl: './home-customization-modal.component.html',
  styleUrls: ['./home-customization-modal.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonButtons,
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonToggle,
    IonReorder,
    IonReorderGroup
  ],
})
export class HomeCustomizationModalComponent implements OnInit {
  @Input() clientId!: string;
  @Input() clientName!: string;

  widgets: Widget[] = [
    { id: 'welcome', name: 'Welcome Message', enabled: true, order: 0 },
    { id: 'streak', name: 'Current Streak', enabled: true, order: 1 },
    { id: 'next-workout', name: 'Next Workout', enabled: true, order: 2 },
    { id: 'upcoming-session', name: 'Upcoming Session', enabled: true, order: 3 },
    { id: 'progress-chart', name: 'Progress Chart', enabled: false, order: 4 },
    { id: 'achievements', name: 'Recent Achievements', enabled: false, order: 5 },
    { id: 'nutrition', name: 'Nutrition Tracker', enabled: false, order: 6 },
    { id: 'goals', name: 'Current Goals', enabled: false, order: 7 }
  ];

  customMessage: string = '';

  constructor(
    private modalController: ModalController,
    private firestore: Firestore
  ) {
    addIcons({ close, save, reorderThree });
  }

  ngOnInit() {
    // TODO: Load existing configuration from Firestore
    this.loadClientHomeConfig();
  }

  async loadClientHomeConfig() {
    try {
      const configRef = doc(this.firestore, `clientHomeConfigs/${this.clientId}`);
      const configSnap = await getDoc(configRef);
      
      if (configSnap.exists()) {
        const config = configSnap.data() as HomePageConfig;
        this.widgets = config.widgets;
        this.customMessage = config.customMessage || '';
        console.log('Loaded home config for client:', this.clientId);
      } else {
        console.log('No existing config found, using defaults');
      }
    } catch (error) {
      console.error('Error loading client home config:', error);
    }
  }

  handleReorder(event: any) {
    const itemMove = this.widgets.splice(event.detail.from, 1)[0];
    this.widgets.splice(event.detail.to, 0, itemMove);
    
    // Update order values
    this.widgets.forEach((widget, index) => {
      widget.order = index;
    });

    event.detail.complete();
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async saveConfiguration() {
    const config: HomePageConfig = {
      clientId: this.clientId,
      widgets: this.widgets,
      customMessage: this.customMessage
    };

    try {
      const configRef = doc(this.firestore, `clientHomeConfigs/${this.clientId}`);
      await setDoc(configRef, config, { merge: true });
      console.log('Saved home page configuration:', config);
      this.modalController.dismiss(config);
    } catch (error) {
      console.error('Error saving client home config:', error);
      // Still dismiss with the config so the user knows what was attempted
      this.modalController.dismiss(config);
    }
  }
}
