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
  IonTextarea,
  IonToggle,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addCircle,
  analyticsOutline,
  alertCircleOutline,
  barbell,
  calendar,
  calendarOutline,
  cardOutline,
  chatbubblesOutline,
  chevronDownOutline,
  chevronUpOutline,
  close,
  eyeOutline,
  fitnessOutline,
  flame,
  gridOutline,
  menuOutline,
  peopleOutline,
  personCircle,
  personOutline,
  pulseOutline,
  save,
  checkmarkCircle,
  trophyOutline
} from 'ionicons/icons';

interface Widget {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  order: number;
  previewTitle: string;
  previewText: string;
}

interface HomePageConfig {
  clientId: string;
  widgets: Widget[];
  customMessage?: string;
}

const WIDGET_CATALOG: Widget[] = [
  {
    id: 'welcome',
    name: 'Trainer Message',
    description: 'A custom note at the top of the client home page',
    icon: 'chatbubbles-outline',
    enabled: true,
    order: 0,
    previewTitle: 'A message from your trainer',
    previewText: 'A short message from you appears here.'
  },
  {
    id: 'start-workout',
    name: 'Start Workout',
    description: 'Primary button to begin logging a workout',
    icon: 'add-circle',
    enabled: true,
    order: 1,
    previewTitle: 'Start Logging Workout',
    previewText: 'Begin tracking your session'
  },
  {
    id: 'live-session',
    name: 'Live Session',
    description: 'Quick access to live heart-rate workout tracking',
    icon: 'fitness-outline',
    enabled: true,
    order: 2,
    previewTitle: 'Live Session',
    previewText: 'Track heart rate live during a workout'
  },
  {
    id: 'streak',
    name: 'Current Streak',
    description: "Shows the client's active workout streak",
    icon: 'flame',
    enabled: true,
    order: 3,
    previewTitle: '7 Day Streak',
    previewText: 'Consistency snapshot'
  },
  {
    id: 'next-workout',
    name: 'Next Workout',
    description: 'Highlights the next assigned workout plan',
    icon: 'barbell',
    enabled: true,
    order: 4,
    previewTitle: 'Next Workout',
    previewText: 'Upper Body Strength - Today'
  },
  {
    id: 'upcoming-session',
    name: 'Sessions',
    description: 'Shows pending and confirmed training sessions',
    icon: 'calendar',
    enabled: true,
    order: 5,
    previewTitle: 'Sessions',
    previewText: 'Next confirmed or pending booking'
  },
  {
    id: 'request-session',
    name: 'Request Session',
    description: 'Lets the client request an open trainer slot',
    icon: 'calendar-outline',
    enabled: true,
    order: 6,
    previewTitle: 'Request Session',
    previewText: 'Pick an open trainer slot'
  },
  {
    id: 'workout-history',
    name: 'Workout History',
    description: 'Quick access to previous logged workouts',
    icon: 'pulse-outline',
    enabled: false,
    order: 7,
    previewTitle: 'Workout History',
    previewText: 'Review previous sessions'
  },
  {
    id: 'workout-insights',
    name: 'Workout Insights',
    description: 'Links to progress and health insights',
    icon: 'analytics-outline',
    enabled: false,
    order: 8,
    previewTitle: 'Workout Insights',
    previewText: 'Trends, recovery, and progress'
  },
  {
    id: 'groups',
    name: 'Groups',
    description: 'Opens client groups and group wars',
    icon: 'people-outline',
    enabled: false,
    order: 9,
    previewTitle: 'Groups',
    previewText: 'Community challenges and teams'
  },
  {
    id: 'leaderboard',
    name: 'Leaderboard',
    description: 'Regional rankings and competition',
    icon: 'trophy-outline',
    enabled: false,
    order: 10,
    previewTitle: 'Leaderboard',
    previewText: 'Regional rankings'
  },
  {
    id: 'chat',
    name: 'Messages',
    description: 'Shortcut to trainer and client chats',
    icon: 'chatbubbles-outline',
    enabled: false,
    order: 11,
    previewTitle: 'Messages',
    previewText: 'Open client conversations'
  },
  {
    id: 'payments',
    name: 'Payments',
    description: 'Client payments and agreement actions',
    icon: 'card-outline',
    enabled: false,
    order: 12,
    previewTitle: 'Payments',
    previewText: 'Invoices and payment requests'
  },
  {
    id: 'profile',
    name: 'Profile',
    description: 'Profile, badges, and personal progress',
    icon: 'person-outline',
    enabled: false,
    order: 13,
    previewTitle: 'Profile',
    previewText: 'Badges and account details'
  }
];

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
    IonTextarea,
    IonToggle
  ],
})
export class HomeCustomizationModalComponent implements OnInit {
  @Input() clientId!: string;
  @Input() clientName!: string;

  widgets: Widget[] = this.cloneCatalog();
  customMessage = '';
  private draggedWidgetId: string | null = null;

  constructor(
    private modalController: ModalController,
    private firestore: Firestore
  ) {
    addIcons({
      addCircle,
      analyticsOutline,
      alertCircleOutline,
      barbell,
      calendar,
      calendarOutline,
      cardOutline,
      chatbubblesOutline,
      checkmarkCircle,
      chevronDownOutline,
      chevronUpOutline,
      close,
      eyeOutline,
      fitnessOutline,
      flame,
      gridOutline,
      menuOutline,
      peopleOutline,
      personCircle,
      personOutline,
      pulseOutline,
      save,
      trophyOutline
    });
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
        this.customMessage = config.customMessage || '';
        this.widgets = this.mergeSavedWidgets(config.widgets || []);
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

  toggleWidget(widget: Widget): void {
    widget.enabled = !widget.enabled;
  }

  onDragStart(event: DragEvent, widget: Widget): void {
    this.draggedWidgetId = widget.id;
    event.dataTransfer?.setData('text/plain', widget.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, targetWidget: Widget): void {
    event.preventDefault();
    const sourceId = this.draggedWidgetId || event.dataTransfer?.getData('text/plain') || '';
    this.draggedWidgetId = null;
    if (!sourceId || sourceId === targetWidget.id) {
      return;
    }

    this.moveWidgetTo(sourceId, targetWidget.id);
  }

  onDragEnd(): void {
    this.draggedWidgetId = null;
  }

  moveWidget(widget: Widget, direction: -1 | 1, event?: Event): void {
    event?.stopPropagation();
    const currentIndex = this.widgets.findIndex(w => w.id === widget.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= this.widgets.length) {
      return;
    }

    const reordered = [...this.widgets];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    this.widgets = this.withSequentialOrder(reordered);
  }

  async saveConfiguration() {
    const config: HomePageConfig = {
      clientId: this.clientId,
      widgets: this.withSequentialOrder(this.widgets),
      customMessage: this.customMessage.trim()
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

  private moveWidgetTo(sourceId: string, targetId: string): void {
    const sourceIndex = this.widgets.findIndex(w => w.id === sourceId);
    const targetIndex = this.widgets.findIndex(w => w.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const reordered = [...this.widgets];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    this.widgets = this.withSequentialOrder(reordered);
  }

  private mergeSavedWidgets(savedWidgets: Widget[]): Widget[] {
    const catalogById = new Map(WIDGET_CATALOG.map(widget => [widget.id, widget]));
    const savedById = new Map(
      savedWidgets
        .filter(widget => catalogById.has(widget.id))
        .map(widget => [widget.id, widget])
    );

    const merged = WIDGET_CATALOG.map(defaultWidget => {
      const saved = savedById.get(defaultWidget.id);
      return {
        ...defaultWidget,
        enabled: saved?.enabled ?? defaultWidget.enabled,
        order: Number.isFinite(Number(saved?.order)) ? Number(saved?.order) : defaultWidget.order
      };
    });

    return this.withSequentialOrder(
      merged.sort((a, b) => a.order - b.order)
    );
  }

  private cloneCatalog(): Widget[] {
    return WIDGET_CATALOG.map(widget => ({ ...widget }));
  }

  private withSequentialOrder(widgets: Widget[]): Widget[] {
    return widgets.map((widget, index) => ({
      ...widget,
      order: index
    }));
  }
}
