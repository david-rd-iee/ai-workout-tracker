// src/app/services/group.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  docData,
  getDoc,
  getDocs,
  collection,
  addDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from '@angular/fire/firestore';

import { Observable, of, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Group } from '../models/groups.model';
import { AppUser } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class GroupService {
  private readonly groupsCollectionName = 'groupID';

  constructor(private firestore: Firestore) {}

  /**
   * Get the AppUser doc for a given uid.
   */
  getUser(uid: string): Observable<AppUser | undefined> {
    const userRef = doc(this.firestore, 'users', uid);
    return docData(userRef).pipe(
      map((data) => (data as AppUser) ?? undefined)
    );
  }

  /**
   * Get a single group by its document ID (groupId).
   * Uses getDoc so the observable completes.
   */
  getGroup(groupId: string): Observable<Group | undefined> {
    const ref = doc(this.firestore, this.groupsCollectionName, groupId);
    return from(getDoc(ref)).pipe(
      map((snap) => {
        if (!snap.exists()) return undefined;
        const data = snap.data() as Omit<Group, 'groupId'>;
        return { groupId, ...data };
      })
    );
  }

  /**
   * Get multiple groups by their IDs.
   * Uses Promise.all so it completes even though Firestore streams are live.
   */
  getGroupsByIds(groupIds: string[]): Observable<Group[]> {
    if (!groupIds || groupIds.length === 0) {
      return of([]);
    }

    const colName = this.groupsCollectionName;

    const promises = groupIds.map(async (id) => {
      const ref = doc(this.firestore, colName, id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return undefined;

      const data = snap.data() as Omit<Group, 'groupId'>;
      return { groupId: id, ...data } as Group;
    });

    return from(Promise.all(promises)).pipe(
      map((groups) => groups.filter((g): g is Group => !!g))
    );
  }

  /**
   * Get all groups once from Firestore.
   */
  async getAllGroupsOnce(): Promise<Group[]> {
    const colRef = collection(this.firestore, this.groupsCollectionName);
    const snap = await getDocs(colRef);

    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<Group, 'groupId'>;
      return { groupId: docSnap.id, ...data };
    });
  }

  /**
   * Get the user's AppUser record plus all groups they belong to.
   * Relies on AppUser.groups: string[].
   */
  getUserGroups(uid: string): Observable<{ user: AppUser | undefined; groups: Group[] }> {
    return this.getUser(uid).pipe(
      switchMap((user) => {
        const ids = user?.groupID ?? [];
        return this.getGroupsByIds(ids).pipe(
          map((groups) => ({ user, groups }))
        );
      })
    );
  }

  /**
   * Create a new group owned by this user and add it to their `groups` array.
   */
  async createGroupForOwner(ownerUid: string, name: string, isPTGroup: boolean): Promise<string> {
    const colRef = collection(this.firestore, this.groupsCollectionName);
    const groupDocRef = await addDoc(colRef, {
      name,
      isPTGroup,
      ownerUserId: ownerUid,
      created_at: serverTimestamp(),
    });

    const groupId = groupDocRef.id;

    const userRef = doc(this.firestore, 'users', ownerUid);
    await updateDoc(userRef, {
      groups: arrayUnion(groupId),
    });

    return groupId;
  }
}
