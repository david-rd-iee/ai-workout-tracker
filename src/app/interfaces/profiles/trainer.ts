export interface TrainerProfile {
  uid: string;
  email: string;
  accountType: 'trainer';
  displayName?: string;
  photoURL?: string;
  firstName?: string;
  lastName?: string;
  specialization?: string[];
  bio?: string;
  experience?: number;
  rating?: number;
  clients?: string[];
  unreadMessageCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
  // Add more trainer-specific properties as needed
}
