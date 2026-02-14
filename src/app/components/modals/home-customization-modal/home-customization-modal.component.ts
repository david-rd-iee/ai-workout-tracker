import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { 
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
  IonToggle,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, save, checkmarkCircle, personCircle, gridOutline, eyeOutline, alertCircleOutline, flame, calendar, barbell } from 'ionicons/icons';

interface Widget {
  id: string;
  name: string;
  description: string;
  icon: string;
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
    IonToggle
  ],
})
export class HomeCustomizationModalComponent implements OnInit {
  @Input() clientId!: string;
  @Input() clientName!: string;

  widgets: Widget[] = [
    { 
      id: 'streak', 
      name: 'Current Streak', 
      description: 'Shows active workout streak',
      icon: 'flame',
      enabled: true, 
      order: 0 
    },
    { 
      id: 'upcoming-session', 
      name: 'Upcoming Session', 
      description: 'Next scheduled training session',
      icon: 'calendar',
      enabled: true, 
      order: 1 
    },
    { 
      id: 'next-workout', 
      name: 'Next Workout', 
      description: 'Next assigned workout plan',
      icon: 'barbell',
      enabled: true, 
      order: 2 
    }
  ];

  constructor(
    private modalController: ModalController,
    private firestore: Firestore
  ) {
    addIcons({ close, save, checkmarkCircle, personCircle, gridOutline, eyeOutline, alertCircleOutline, flame, calendar, barbell });
  }

  ngOnInit() {
    this.loadClientHomeConfig();
  }

  async loadClientHomeConfig() {
    try {
      const configRef = doc(this.firestore, `clientHomeConfigs/${this.clientId}`);
      const configSnap = await getDoc(configRef);
      
      if (configSnap.exists()) {
        const config = configSnap.data() as HomePageConfig;
        
        // Filter to only include allowed widget IDs
        const allowedIds = ['streak', 'upcoming-session', 'next-workout'];
        const savedWidgets = config.widgets.filter(w => allowedIds.includes(w.id));
        
        // Merge saved settings with defaults
        this.widgets = this.widgets.map(defaultWidget => {
          const saved = savedWidgets.find(w => w.id === defaultWidget.id);
          return saved || defaultWidget;
        });
        
        console.log('Loaded home config for client:', this.clientId);
      } else {
        console.log('No existing config found, using defaults');
      }
    } catch (error) {
      console.error('Error loading client home config:', error);
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }

  getEnabledWidgets(): Widget[] {
    return this.widgets.filter(w => w.enabled).sort((a, b) => a.order - b.order);
  }

  async saveConfiguration() {
    const config: HomePageConfig = {
      clientId: this.clientId,
      widgets: this.widgets
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
