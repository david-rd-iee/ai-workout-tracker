// src/app/models/user-statues.model.ts
import { Timestamp } from '@angular/fire/firestore';

/**
 * Stored in Firestore in: /userStatues/{userId}
 *
 * - `values`       = how far the user has progressed on carving each statue
 * - `percentiles`  = (optional) percentile ranking for each statue
 * - `displayStatueIds` = which statues the user wants to show on their profile
 * - `displayBadgeIds` = legacy field for backwards compatibility
 */
export interface UserStatuesDoc {
  userId: string;

  // Statue carving progress: key = statue.id from GREEK_STATUES
  values: { [statueId: string]: number };

  // Optional percentile rankings per statue
  percentiles?: { [statueId: string]: number };

  // Which statues are currently displayed/showcased on the profile
  displayStatueIds?: string[];

  // Legacy field for backwards compatibility
  displayBadgeIds?: string[];

  last_updated_at?: Timestamp;
}
