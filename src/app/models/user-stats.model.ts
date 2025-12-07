// src/app/models/user-stats.model.ts
export interface Region {
  country: string;
  state: string;
  city: string;
}

export interface UserStats {
  userId: string;

  total_work_score: number;
  cardio_work_score: number;
  strength_work_score: number;

  level?: number;

  region?: Region;
  displayName?: string; // optional but nice for UI
}
