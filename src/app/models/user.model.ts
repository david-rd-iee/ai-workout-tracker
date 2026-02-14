export interface AppUser {
  // Attached from Firestore docId via `docData(..., { idField: 'userId' })`
  userId?: string;

  email?: string;

  firstName?: string;
  lastName?: string;
  username?: string;

  role?: string; // "client", "trainer", etc.
  groupID?: string[];

  // URL stored in Firestore under "profilepic", some parts use profileImage, so this was the easiest to implment
  profilepic?: string;
  profileImage?: string;

  created_at?: any; // Firestore timestamp if you use it
}
