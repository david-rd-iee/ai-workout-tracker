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
import { AchievementBadge, ACHIEVEMENT_BADGES } from '../../Interfaces/Badge';
import { AchievementBadgeComponent } from '../achievement-badge/achievement-badge.component';

@Component({
  selector: 'app-badge-selector',
  templateUrl: './badge-selector.component.html',
  styleUrls: ['./badge-selector.component.scss'],
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
    AchievementBadgeComponent
  ]
})
export class BadgeSelectorComponent implements OnInit {
  earnedBadges: AchievementBadge[] = [];
  selectedBadgeIds: string[] = [];
  maxDisplayBadges: number = 3;
  selectedCategory: string = 'all';
  sortBy: string = 'tier';

  constructor(private modalCtrl: ModalController) {
    addIcons({ close, checkmark, checkmarkCircle });
  }

  ngOnInit() {
    // Ensure default values are set
    if (!this.selectedCategory) {
      this.selectedCategory = 'all';
    }
    if (!this.sortBy) {
      this.sortBy = 'tier';
    }
  }

  get filteredBadges(): AchievementBadge[] {
    let badges = this.selectedCategory === 'all' 
      ? [...this.earnedBadges]
      : this.earnedBadges.filter(b => b.category === this.selectedCategory);

    // Sort badges
    const tierOrder = { master: 5, diamond: 4, platinum: 3, gold: 2, silver: 1, bronze: 0 };
    
    if (this.sortBy === 'tier') {
      // Sort by rarity (percentile) - lowest % first (most rare)
      badges.sort((a, b) => {
        const percentileA = a.percentile ?? 100; // Default to 100 if no percentile
        const percentileB = b.percentile ?? 100;
        return percentileA - percentileB; // Lower percentile = more rare = first
      });
    } else if (this.sortBy === 'category') {
      // Sort by tier/rank level - Master to Bronze
      badges.sort((a, b) => {
        const tierA = tierOrder[a.currentLevel || 'bronze'];
        const tierB = tierOrder[b.currentLevel || 'bronze'];
        return tierB - tierA;
      });
    }

    return badges;
  }

  get categories(): string[] {
    const cats = new Set(this.earnedBadges.map(b => b.category));
    return ['all', ...Array.from(cats)];
  }

  isBadgeSelected(badgeId: string): boolean {
    return this.selectedBadgeIds.includes(badgeId);
  }

  toggleBadge(badgeId: string) {
    const index = this.selectedBadgeIds.indexOf(badgeId);
    
    if (index > -1) {
      this.selectedBadgeIds.splice(index, 1);
    } else {
      if (this.selectedBadgeIds.length < this.maxDisplayBadges) {
        this.selectedBadgeIds.push(badgeId);
      }
    }
  }

  clearSelection() {
    this.selectedBadgeIds = [];
  }

  canSelectMore(): boolean {
    return this.selectedBadgeIds.length < this.maxDisplayBadges;
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirm() {
    this.modalCtrl.dismiss(this.selectedBadgeIds, 'confirm');
  }
}
