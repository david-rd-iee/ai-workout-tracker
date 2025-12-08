// src/app/models/user-badges.model.ts
import { Timestamp } from '@angular/fire/firestore';

/**
 * Stored in Firestore in: /userBadges/{userId}
 *
 * - `values`       = how far the user has progressed for each badge
 * - `percentiles`  = (optional) percentile ranking for each badge
 * - `displayBadgeIds` = which badges the user wants to show on their profile
 */
export interface UserBadgesDoc {
  userId: string;

  // Badge progress: key = badge.id from ACHIEVEMENT_BADGES
  values: { [badgeId: string]: number };

  // Optional percentile rankings per badge
  percentiles?: { [badgeId: string]: number };

  // Which badges are currently pinned/displayed on the profile
  displayBadgeIds?: string[];

  last_updated_at?: Timestamp;
}
