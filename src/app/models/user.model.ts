export interface AppUser {
  // Attached from Firestore docId via `docData(..., { idField: 'userId' })`
  userId?: string;

  email?: string;
  phone?: string;
  displayName?: string;

  firstName?: string;
  lastName?: string;
  username?: string;

  isPT: boolean; // "client", "trainer", etc.
  role?: 'client' | 'trainer';
  demoMode?: boolean;
  fitnessLevel?: string;
  goal?: string;
  groupID?: string[];
  groupId?: string;
  groupName?: string;
  groups?: string[];

  // URL stored in Firestore under "profilepic"
  profilepic?: string;

  created_at?: any; // Firestore timestamp if you use it

  trainerId?: string;
  ownedGroupID?: string;
}
