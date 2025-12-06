export interface AppUser {
  userId: string;
  name: string;
  email: string;
  role: 'USER' | 'TRAINER';
  groups: string[];
  height_cm?: number;
  weight_kg?: number;
  created_at?: any; // Firestore timestamp
}
