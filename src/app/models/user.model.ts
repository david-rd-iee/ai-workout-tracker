export interface AppUser {
  // Attached from Firestore docId via `docData(..., { idField: 'userId' })`
  userId?: string;

  email?: string;

  firstName?: string;
  lastName?: string;
  username?: string;

  role?: string; // "client", "trainer", etc.
  groupID?: string[];

  // URL stored in Firestore under "profilepic"
  profilepic?: string;

  created_at?: any; // Firestore timestamp if you use it
}
