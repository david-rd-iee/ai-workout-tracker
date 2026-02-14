// src/app/models/group.model.ts

import { Timestamp } from '@angular/fire/firestore';

export interface Group {
  groupId: string;
  name: string;
  isPTGroup: boolean;
  ownerUserId: string;
  created_at: Timestamp;
  groupImage?: string;
}
