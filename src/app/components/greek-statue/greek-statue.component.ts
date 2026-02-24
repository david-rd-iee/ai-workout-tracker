import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonBadge, IonProgressBar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trophy, star, lockClosed, medalOutline, trophyOutline, diamondOutline, body, shieldCheckmark, flame, speedometer, sunny, people, analytics, calendar, barbell, bed, fitness, hammerOutline, constructOutline, shield, flash, ribbon, beer, sparkles, hourglass, informationCircleOutline } from 'ionicons/icons';
import {
  GreekStatue,
  StatueLevel,
  STATUE_TIER_CONFIG,
  calculateCarvingProgress,
  getCarvingStageDescription,
} from '../../interfaces/GreekStatue';


@Component({
  selector: 'app-greek-statue',
  templateUrl: './greek-statue.component.html',
  styleUrls: ['./greek-statue.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    IonBadge,
    IonProgressBar
  ]
})
export class GreekStatueComponent implements OnInit {
  @Input() statue!: GreekStatue;
  @Input() showProgress: boolean = true;
  @Input() size: 'small' | 'medium' | 'large' = 'medium';

  tierConfig = STATUE_TIER_CONFIG;
  progress: {
    currentLevel: StatueLevel | null;
    nextLevel: StatueLevel | null;
    nextTierValue: number | null;
    progressPercentage: number;
    carvingPercentage: number;
  } | null = null;

  constructor() {
    addIcons({ 
      trophy, 
      star, 
      lockClosed,
      medalOutline,
      trophyOutline,
      diamondOutline,
      body,
      shieldCheckmark,
      flame,
      speedometer,
      sunny,
      people,
      analytics,
      calendar,
      barbell,
      bed,
      fitness,
      hammerOutline,
      constructOutline,
      shield,
      flash,
      ribbon,
      beer,
      sparkles,
      hourglass,
      informationCircleOutline
    });
  }

  ngOnInit() {
    if (this.statue.currentValue !== undefined) {
      this.progress = calculateCarvingProgress(this.statue, this.statue.currentValue);
    }
  }

  get currentTierConfig() {
    if (this.progress?.currentLevel) {
      return this.tierConfig[this.progress.currentLevel];
    }
    return null;
  }

  get statueGradient() {
    if (this.currentTierConfig) {
      return `linear-gradient(135deg, ${this.currentTierConfig.gradientStart}, ${this.currentTierConfig.gradientEnd})`;
    }
    return 'linear-gradient(135deg, #4A4A4A, #2A2A2A)'; // Dark stone for uncarved
  }

  get isUncarved() {
    return !this.progress?.currentLevel;
  }

  get percentileText() {
    if (this.statue.percentile !== undefined) {
      return `Top ${this.statue.percentile.toFixed(1)}%`;
    }
    return null;
  }

  get carvingStageDescription() {
    return getCarvingStageDescription(this.progress?.currentLevel || null);
  }

  formatValue(value: number): string {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  }

  getTierIcon(level: StatueLevel): string {
    const tierIcons: Record<StatueLevel, string> = {
      'rough': 'hammer-outline',
      'outlined': 'hammer-outline',
      'detailed': 'construct-outline',
      'polished': 'trophy-outline',
      'gilded': 'diamond-outline',
      'divine': 'star'
    };
    return tierIcons[level] || 'hammer-outline';
  }
}
