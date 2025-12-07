import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonBadge, IonProgressBar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trophy, star, lockClosed, medalOutline, trophyOutline, diamondOutline, body, shieldCheckmark, flame, speedometer, sunny, people, analytics, calendar, barbell, bed, fitness } from 'ionicons/icons';
import { AchievementBadge, BadgeLevel, BADGE_TIER_CONFIG, calculateProgressToNextTier } from '../../Interfaces/Badge';

@Component({
  selector: 'app-achievement-badge',
  templateUrl: './achievement-badge.component.html',
  styleUrls: ['./achievement-badge.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    IonBadge,
    IonProgressBar
  ]
})
export class AchievementBadgeComponent implements OnInit {
  @Input() badge!: AchievementBadge;
  @Input() showProgress: boolean = true;
  @Input() size: 'small' | 'medium' | 'large' = 'medium';

  tierConfig = BADGE_TIER_CONFIG;
  progress: {
    currentLevel: BadgeLevel | null;
    nextLevel: BadgeLevel | null;
    nextTierValue: number | null;
    progressPercentage: number;
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
      fitness
    });
  }

  ngOnInit() {
    if (this.badge.currentValue !== undefined) {
      this.progress = calculateProgressToNextTier(this.badge, this.badge.currentValue);
    }
  }

  get currentTierConfig() {
    if (this.progress?.currentLevel) {
      return this.tierConfig[this.progress.currentLevel];
    }
    return null;
  }

  get badgeGradient() {
    if (this.currentTierConfig) {
      return `linear-gradient(135deg, ${this.currentTierConfig.gradientStart}, ${this.currentTierConfig.gradientEnd})`;
    }
    return 'linear-gradient(135deg, #888, #666)';
  }

  get isLocked() {
    return !this.progress?.currentLevel;
  }

  get percentileText() {
    if (this.badge.percentile !== undefined) {
      return `Top ${this.badge.percentile.toFixed(1)}%`;
    }
    return null;
  }

  formatValue(value: number): string {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  }

  getTierIcon(level: BadgeLevel): string {
    const tierIcons: Record<BadgeLevel, string> = {
      'bronze': 'medal-outline',
      'silver': 'medal-outline',
      'gold': 'medal-outline',
      'platinum': 'trophy-outline',
      'diamond': 'diamond-outline',
      'master': 'star'
    };
    return tierIcons[level] || 'medal-outline';
  }
}
