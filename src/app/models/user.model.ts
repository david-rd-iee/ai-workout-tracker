export interface AppUser {
  /*userId: string;
  name: string;
  email: string;
  isPT: boolean;
  ptUID: string;
  groups: string[];
  height_cm?: number;
  weight_kg?: number;
  created_at?: any; // Firestore timestamp
  */
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  groupID: string[];
  profilePic: string;
  role: string;
  username: string;

}
