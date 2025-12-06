export interface AppUser {
  userId: string;
  name: string;
  email: string;
  isPT: boolean;
  ptUID: string;
  groups: string[];
  height_cm?: number;
  weight_kg?: number;
  created_at?: any; // Firestore timestamp
}
