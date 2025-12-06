import { Injectable } from '@angular/core';
import { Firestore, doc, docData, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { AppUser } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  constructor(private firestore: Firestore) {}

  // Read a single user document as an observable
  getUser(userId: string): Observable<AppUser | undefined> {
    const ref = doc(this.firestore, 'users', userId);
    return docData(ref, { idField: 'userId' }) as unknown as Observable<AppUser | undefined>;
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
      name: user.displayName ?? 'Demo User',
      role: 'USER',
      created_at: serverTimestamp(),
    };

    await setDoc(ref, data, { merge: true });
  }
}
