import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonContent, 
  IonButton, 
  IonButtons,
  IonIcon,
  IonGrid,
  IonRow,
  IonCol,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  ModalController 
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, checkmark, checkmarkCircle } from 'ionicons/icons';
import { GreekStatue, GREEK_STATUES } from '../../interfaces/GreekStatue';
import { GreekStatueComponent } from '../greek-statue/greek-statue.component';

@Component({
  selector: 'app-statue-selector',
  templateUrl: './statue-selector.component.html',
  styleUrls: ['./statue-selector.component.scss'],
  standalone: true,
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
    IonSegment,
    IonSegmentButton,
    IonLabel,
    GreekStatueComponent
  ]
})
export class StatueSelectorComponent implements OnInit {
  carvedStatues: GreekStatue[] = [];
  selectedStatueIds: string[] = [];
  maxDisplayStatues: number = 3;
  selectedCategory: string = 'all';
  sortBy: string = 'carving';

  constructor(private modalCtrl: ModalController) {
    addIcons({ close, checkmark, checkmarkCircle });
  }

  ngOnInit() {
    // Ensure default values are set
    if (!this.selectedCategory) {
      this.selectedCategory = 'all';
    }
    if (!this.sortBy) {
      this.sortBy = 'carving';
    }
  }

  get filteredStatues(): GreekStatue[] {
    let statues = this.selectedCategory === 'all' 
      ? [...this.carvedStatues]
      : this.carvedStatues.filter(s => s.category === this.selectedCategory);

    // Sort statues
    const tierOrder = { divine: 5, gilded: 4, polished: 3, detailed: 2, outlined: 1, rough: 0 };
    
    if (this.sortBy === 'carving') {
      // Sort by rarity (percentile) - lowest % first (most rare)
      statues.sort((a, b) => {
        const percentileA = a.percentile ?? 100;
        const percentileB = b.percentile ?? 100;
        return percentileA - percentileB;
      });
    } else if (this.sortBy === 'category') {
      // Sort by carving level - Divine to Rough
      statues.sort((a, b) => {
        const tierA = tierOrder[a.currentLevel || 'rough'];
        const tierB = tierOrder[b.currentLevel || 'rough'];
        return tierB - tierA;
      });
    }

    return statues;
  }

  get categories(): string[] {
    const cats = new Set(this.carvedStatues.map(s => s.category));
    return ['all', ...Array.from(cats)];
  }

  isStatueSelected(statueId: string): boolean {
    return this.selectedStatueIds.includes(statueId);
  }

  toggleStatue(statueId: string) {
    const index = this.selectedStatueIds.indexOf(statueId);
    
    if (index > -1) {
      this.selectedStatueIds.splice(index, 1);
    } else {
      if (this.selectedStatueIds.length < this.maxDisplayStatues) {
        this.selectedStatueIds.push(statueId);
      }
    }
  }

  clearSelection() {
    this.selectedStatueIds = [];
  }

  canSelectMore(): boolean {
    return this.selectedStatueIds.length < this.maxDisplayStatues;
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirm() {
    this.modalCtrl.dismiss(this.selectedStatueIds, 'confirm');
  }
}
