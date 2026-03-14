import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { AppUser } from '../models/user.model';
import { watchDocumentData } from './firestore-streams.util';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  constructor(private firestore: Firestore) {}

  // Read a single user document as an observable
  getUser(userId: string): Observable<AppUser | undefined> {
    return watchDocumentData<AppUser>(doc(this.firestore, 'users', userId), {
      idField: 'userId',
    });
  }

  // Create or update a user document (e.g., from Firebase Auth user)
  async upsertUser(user: {
    uid: string;
    email: string | null;
    displayName?: string | null;
  }): Promise<void> {
    const ref = doc(this.firestore, 'users', user.uid);

    const data: Partial<AppUser> = {
      userId: user.uid,
      email: user.email ?? '',
      firstName: '',
      lastName: '',
      username: user.displayName ?? '',
      created_at: serverTimestamp(),
    };

    await setDoc(ref, data, { merge: true });
  }
}
