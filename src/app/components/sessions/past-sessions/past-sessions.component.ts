import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { IonButton, IonCard, IonCardContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, close } from 'ionicons/icons';

interface PastSessionViewModel {
  type: string;
  date: Date | null;
  duration: number;
}

@Component({
  selector: 'app-past-sessions',
  standalone: true,
  templateUrl: './past-sessions.component.html',
  styleUrls: ['./past-sessions.component.scss'],
  imports: [CommonModule, IonCard, IonCardContent, IonIcon, IonButton],
})
export class PastSessionsComponent {
  @Input() sessions: any[] = [];

  isOpen = false;

  constructor() {
    addIcons({ checkmarkCircle, close });
  }

  get sortedSessions(): PastSessionViewModel[] {
    return [...(this.sessions || [])]
      .map((session) => ({
        type: String(session?.type || 'Training Session'),
        date: this.toDate(session?.date),
        duration: Number(session?.duration || 60) || 60,
      }))
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  }

  open(): void {
    if (!this.sortedSessions.length) {
      return;
    }
    this.isOpen = true;
  }

  close(): void {
    this.isOpen = false;
  }

  private toDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    const parsed = new Date(String(value || ''));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}

