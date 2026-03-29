// src/app/models/user-badges.model.ts
import { Timestamp } from '@angular/fire/firestore';
import { BadgeLevel } from '../interfaces/Badge';
import { StoredStatueLevel } from './greek-statue.model';

export type UserBadgeLevel = BadgeLevel | StoredStatueLevel;

/**
 * Stored in Firestore in: /userStats/{userId}/Badges/{badgeOrStatueId}
 */
export interface UserBadgeStatDoc {
  id: string;
  userId: string;
  isDisplayed: boolean;
  metricValue?: number;
  currentValue?: number;
  currentLevel?: UserBadgeLevel;
  percentile?: number;
  nextTierValue?: number;
  progressToNext?: number;
  updatedAt?: Timestamp;
}

export type UserBadgeStatsMap = Record<string, UserBadgeStatDoc>;
