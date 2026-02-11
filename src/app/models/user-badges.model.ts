// src/app/models/user-badges.model.ts
import { Timestamp } from '@angular/fire/firestore';

/**
 * Stored in Firestore in: /userBadges/{userId} or /userStatues/{userId}
 *
 * - `values`       = how far the user has progressed for each badge/statue
 * - `percentiles`  = (optional) percentile ranking for each badge/statue
 * - `displayBadgeIds` / `displayStatueIds` = which badges/statues to show on profile
 */
export interface UserBadgesDoc {
  userId: string;

  // Badge/Statue progress: key = badge.id from ACHIEVEMENT_BADGES or statue.id from GREEK_STATUES
  values: { [badgeId: string]: number };

  // Optional percentile rankings per badge/statue
  percentiles?: { [badgeId: string]: number };

  // Which badges are currently pinned/displayed on the profile (legacy)
  displayBadgeIds?: string[];

  // Which statues are currently displayed/showcased on the profile (new)
  displayStatueIds?: string[];

  last_updated_at?: Timestamp;
}

// New interface for statue-specific typing
export interface UserStatuesDoc extends UserBadgesDoc {
  displayStatueIds?: string[];
}
