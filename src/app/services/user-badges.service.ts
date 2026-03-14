import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { UserBadgesDoc } from '../models/user-badges.model';

@Injectable({
  providedIn: 'root',
})
export class UserBadgesService {
  constructor(private firestore: Firestore) {}

  observeUserBadges(
    userId: string,
    observer: (userBadges: UserBadgesDoc | null) => void
  ): () => void {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      observer(null);
      return () => undefined;
    }

    const badgeRef = doc(this.firestore, 'userBadges', normalizedUserId);
    return onSnapshot(
      badgeRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          observer(null);
          return;
        }

        observer({
          userId: normalizedUserId,
          ...(snapshot.data() as Omit<UserBadgesDoc, 'userId'>),
        });
      },
      (error) => {
        console.error('[UserBadgesService] Failed to observe userBadges:', error);
        observer(null);
      }
    );
  }

  watchUserBadges(userId: string): Observable<UserBadgesDoc | null> {
    return new Observable<UserBadgesDoc | null>((subscriber) => {
      const unsubscribe = this.observeUserBadges(userId, (userBadges) => {
        subscriber.next(userBadges);
      });

      return () => unsubscribe();
    });
  }

  async saveDisplayStatues(userId: string, displayStatueIds: string[]): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      throw new Error('User ID is required to save display statues.');
    }

    const sanitizedDisplayIds = Array.from(
      new Set(
        (displayStatueIds ?? [])
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0)
      )
    );

    const badgeRef = doc(this.firestore, 'userBadges', normalizedUserId);
    await setDoc(
      badgeRef,
      {
        displayStatueIds: sanitizedDisplayIds,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}
