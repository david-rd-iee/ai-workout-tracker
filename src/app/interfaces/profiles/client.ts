export interface ClientProfile {
  uid: string;
  email: string;
  accountType: 'client';
  displayName?: string;
  photoURL?: string;
  firstName?: string;
  lastName?: string;
  age?: number;
  height?: number;
  weight?: number;
  goals?: string[];
  trainerId?: string;
  unreadMessageCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
  // Add more client-specific properties as needed
}
