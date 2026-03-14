// src/app/services/group.service.ts
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { Observable, of, from, combineLatest } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Group } from '../models/groups.model';
import { AppUser } from '../models/user.model';
import { ProfileRepositoryService } from './account/profile-repository.service';
import { watchDocumentData, watchQueryData } from './firestore-streams.util';

@Injectable({
  providedIn: 'root',
})
export class GroupService {
  private readonly groupsCollectionName = 'groupID';

  constructor(
    private firestore: Firestore,
    private profileRepository: ProfileRepositoryService
  ) {}

  /**
   * Get the AppUser doc for a given uid.
   */
  getUser(uid: string): Observable<AppUser | undefined> {
    return this.profileRepository.watchUserSummary(uid);
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
   * Get multiple groups by their IDs as live Firestore streams.
   */
  getGroupsByIds(groupIds: string[]): Observable<Group[]> {
    if (!groupIds || groupIds.length === 0) {
      return of([]);
    }

    const streams = groupIds.map((id) => {
      const ref = doc(this.firestore, this.groupsCollectionName, id);
      return watchDocumentData<Group>(ref, { idField: 'groupId' }).pipe(
        map((data) => data ?? undefined)
      );
    });

    return combineLatest(streams).pipe(
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

  watchAllGroups(): Observable<Group[]> {
    const colRef = collection(this.firestore, this.groupsCollectionName);
    return watchQueryData<Group>(colRef, { idField: 'groupId' }).pipe(
      map((groups) => groups as Group[])
    );
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
   * Create a new group owned by this user and add it to their `groupID` array.
   */
  async createGroupForOwner(ownerUid: string, name: string, isPTGroup: boolean): Promise<string> {
    const colRef = collection(this.firestore, this.groupsCollectionName);
    const groupDocRef = await addDoc(colRef, {
      name,
      isPTGroup,
      ownerUserId: ownerUid,
      groupImage: '',
      created_at: serverTimestamp(),
      userIDs: [ownerUid],
    });

    const groupId = groupDocRef.id;

    const userRef = doc(this.firestore, 'users', ownerUid);
    await updateDoc(userRef, {
      groupID: arrayUnion(groupId),
    });
    this.profileRepository.invalidateUser(ownerUid);

    return groupId;
  }

  /**
   * Resolve a trainer's PT group using trainers/{uid}.trainerGroupID.
   */
  async getTrainerPtGroupByTrainerUid(trainerUid: string): Promise<Group | undefined> {
    const normalizedTrainerUid = this.normalizeString(trainerUid);
    if (!normalizedTrainerUid) {
      return undefined;
    }

    const trainerProfile = await this.profileRepository.getProfile(normalizedTrainerUid, 'trainer');
    if (!trainerProfile) {
      return undefined;
    }

    const groupId = this.normalizeString(
      (trainerProfile as unknown as Record<string, unknown>)['trainerGroupID']
    );
    if (!groupId) {
      return undefined;
    }

    return this.getGroupOnce(groupId);
  }

  async hasTrainerProfile(trainerUid: string): Promise<boolean> {
    const normalizedTrainerUid = this.normalizeString(trainerUid);
    if (!normalizedTrainerUid) {
      return false;
    }

    const trainerProfile = await this.profileRepository.getProfile(normalizedTrainerUid, 'trainer');
    if (trainerProfile) {
      return true;
    }

    const userSummary = await this.profileRepository.getUserSummary(normalizedTrainerUid);
    return userSummary?.isPT === true;
  }

  /**
   * Ensure a trainer has a PT group. If missing, create one and add trainer clients as members.
   */
  async ensureTrainerPtGroup(trainerUid: string): Promise<Group | undefined> {
    const normalizedTrainerUid = this.normalizeString(trainerUid);
    if (!normalizedTrainerUid) {
      return undefined;
    }

    const trainerRef = doc(this.firestore, 'trainers', normalizedTrainerUid);
    const [trainerProfile, userSummary] = await Promise.all([
      this.profileRepository.getProfile(normalizedTrainerUid, 'trainer'),
      this.profileRepository.getUserSummary(normalizedTrainerUid),
    ]);

    const trainerData = trainerProfile
      ? (trainerProfile as unknown as Record<string, unknown>)
      : {};
    const userData = userSummary
      ? (userSummary as unknown as Record<string, unknown>)
      : {};

    const isPtUser = trainerData['isPT'] === true || userData['isPT'] === true;
    if (!isPtUser) {
      return undefined;
    }

    const existingTrainerGroupId = this.normalizeString(trainerData['trainerGroupID']);
    if (existingTrainerGroupId) {
      const existingGroup = await this.getGroupOnce(existingTrainerGroupId);
      if (existingGroup) {
        return existingGroup;
      }
    }

    const trainerIdentityData = trainerProfile ? trainerData : userData;

    // Ensure trainer doc exists so trainerGroupID can be persisted there.
    await setDoc(
      trainerRef,
      {
        firstName: this.normalizeString(trainerIdentityData['firstName']),
        lastName: this.normalizeString(trainerIdentityData['lastName']),
        isPT: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    this.profileRepository.applyProfilePatch(normalizedTrainerUid, 'trainer', {
      firstName: this.normalizeString(trainerIdentityData['firstName']),
      lastName: this.normalizeString(trainerIdentityData['lastName']),
      isPT: true,
    });
    this.profileRepository.applyUserSummaryPatch(normalizedTrainerUid, { isPT: true });

    const clientIds = await this.getTrainerClientUserIds(normalizedTrainerUid);
    const userIds = Array.from(new Set(clientIds));
    const groupName = this.resolveTrainerGroupName(trainerIdentityData);

    const groupDocRef = await addDoc(collection(this.firestore, this.groupsCollectionName), {
      name: groupName,
      isPTGroup: true,
      ownerUserId: normalizedTrainerUid,
      groupImage: '',
      created_at: serverTimestamp(),
      userIDs: userIds,
    });

    const groupId = groupDocRef.id;

    await setDoc(
      trainerRef,
      {
        trainerGroupID: groupId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    this.profileRepository.applyProfilePatch(normalizedTrainerUid, 'trainer', {
      trainerGroupID: groupId,
    });

    return this.getGroupOnce(groupId);
  }

  private async getTrainerClientUserIds(trainerUid: string): Promise<string[]> {
    const clientsSnap = await getDocs(collection(this.firestore, `trainers/${trainerUid}/clients`));
    const userIds = new Set<string>();

    clientsSnap.forEach((clientDoc) => {
      const data = clientDoc.data() as Record<string, unknown>;
      const candidateId =
        this.normalizeString(data['clientId']) ||
        this.normalizeString(data['uid']) ||
        this.normalizeString(data['userId']) ||
        this.normalizeString(clientDoc.id);

      if (candidateId) {
        userIds.add(candidateId);
      }
    });

    return Array.from(userIds);
  }

  private resolveTrainerGroupName(trainerData: Record<string, unknown>): string {
    const firstName = this.normalizeString(trainerData['firstName']);
    const lastName = this.normalizeString(trainerData['lastName']);
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) {
      return `${fullName}'s Trainees`;
    }
    return 'PT Trainees';
  }

  private async getGroupOnce(groupId: string): Promise<Group | undefined> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      return undefined;
    }

    const ref = doc(this.firestore, this.groupsCollectionName, normalizedGroupId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return undefined;
    }

    const data = snap.data() as Omit<Group, 'groupId'>;
    return { groupId: normalizedGroupId, ...data };
  }

  private normalizeString(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }
}
