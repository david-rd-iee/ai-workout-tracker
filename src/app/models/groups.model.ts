// src/app/models/group.model.ts

import { Timestamp } from '@angular/fire/firestore';

export interface Group {
  groupId: string;
  name: string;
  isPTGroup: boolean;
  ownerUserId: string;
  created_at: Timestamp;
  groupImage?: string;
  groupType?: string;
  demoMode?: boolean;
  eventGroup?: boolean;
  userIDs: string[];
  warOptIn: boolean;
  warEnabled: boolean;
  warRating: number;
  warWeight: number;
  totalWarLeaderboardPoints: number;
  globalLeaderboardRank?: number;
  wins: number;
  losses: number;
  ties: number;
  currentActiveWarId?: string;
  dominantExerciseTag?: string;
  lastWarEndedAt?: Timestamp;
}
