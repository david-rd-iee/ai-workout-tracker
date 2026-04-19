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
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { Observable, of, from, combineLatest } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Group } from '../models/groups.model';
import { AppUser } from '../models/user.model';
import { ProfileRepositoryService } from './account/profile-repository.service';
import { watchDocumentData, watchQueryData } from './firestore-streams.util';

export interface GroupWarProfile {
  groupId: string;
  name: string;
  ownerUserId: string;
  warOptIn: boolean;
  warEnabled: boolean;
  warRating: number;
  warWeight: number;
  totalWarLeaderboardPoints: number;
  globalLeaderboardRank?: number;
  wins: number;
  losses: number;
  ties: number;
  currentActiveWarId?: string;
  dominantExerciseTag?: string;
  lastWarEndedAt?: Timestamp;
}

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
        return this.buildGroup(groupId, snap.data() as Record<string, unknown>);
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
      return watchDocumentData<Record<string, unknown>>(ref, { idField: 'groupId' }).pipe(
        map((data) => {
          if (!data) return undefined;
          return this.buildGroup(id, data);
        })
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
      return this.buildGroup(docSnap.id, docSnap.data() as Record<string, unknown>);
    });
  }

  watchAllGroups(): Observable<Group[]> {
    const colRef = collection(this.firestore, this.groupsCollectionName);
    return watchQueryData<Record<string, unknown>>(colRef, { idField: 'groupId' }).pipe(
      map((groups) => groups.map((groupDoc) => this.buildGroup(groupDoc['groupId'], groupDoc)))
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
   * Toggle whether a group owner opts this group into Group Wars.
   * This intentionally only updates opt-in state and does not run war orchestration.
   */
  async setWarOptIn(groupId: string, enabled: boolean): Promise<void> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      throw new Error('groupId is required.');
    }

    await updateDoc(doc(this.firestore, this.groupsCollectionName, normalizedGroupId), {
      warOptIn: !!enabled,
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * Watch a group's war-facing profile fields.
   * Keeps GroupService focused on ownership + identity context for war workflows.
   */
  watchGroupWarProfile(groupId: string): Observable<GroupWarProfile | undefined> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      return of(undefined);
    }

    const ref = doc(this.firestore, this.groupsCollectionName, normalizedGroupId);
    return watchDocumentData<Record<string, unknown>>(ref, { idField: 'groupId' }).pipe(
      map((data) => {
        if (!data) {
          return undefined;
        }
        const group = this.buildGroup(normalizedGroupId, data);
        return this.toGroupWarProfile(group);
      })
    );
  }

  /**
   * Watch groups owned by a given user.
   */
  watchUserOwnedGroups(uid: string): Observable<Group[]> {
    const normalizedUid = this.normalizeString(uid);
    if (!normalizedUid) {
      return of([]);
    }

    const ownedGroupsQuery = query(
      collection(this.firestore, this.groupsCollectionName),
      where('ownerUserId', '==', normalizedUid)
    );

    return watchQueryData<Record<string, unknown>>(ownedGroupsQuery, { idField: 'groupId' }).pipe(
      map((groups) => groups.map((groupDoc) => this.buildGroup(groupDoc['groupId'], groupDoc)))
    );
  }

  /**
   * Check whether a uid is the owner of a given group.
   */
  async isGroupOwner(groupId: string, uid: string): Promise<boolean> {
    const normalizedGroupId = this.normalizeString(groupId);
    const normalizedUid = this.normalizeString(uid);
    if (!normalizedGroupId || !normalizedUid) {
      return false;
    }

    const groupSnap = await getDoc(doc(this.firestore, this.groupsCollectionName, normalizedGroupId));
    if (!groupSnap.exists()) {
      return false;
    }

    const ownerUserId = this.normalizeString((groupSnap.data() as Record<string, unknown>)['ownerUserId']);
    return ownerUserId === normalizedUid;
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
      ...this.buildWarDefaults(),
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
      ...this.buildWarDefaults(),
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

    return this.buildGroup(normalizedGroupId, snap.data() as Record<string, unknown>);
  }

  private buildWarDefaults(): Pick<
    Group,
    | 'warOptIn'
    | 'warEnabled'
    | 'warRating'
    | 'warWeight'
    | 'totalWarLeaderboardPoints'
    | 'wins'
    | 'losses'
    | 'ties'
  > {
    return {
      warOptIn: false,
      warEnabled: false,
      warRating: 1000,
      warWeight: 1,
      totalWarLeaderboardPoints: 0,
      wins: 0,
      losses: 0,
      ties: 0,
    };
  }

  private buildGroup(groupId: unknown, data: Record<string, unknown>): Group {
    const normalizedGroupId = this.normalizeString(groupId);
    const currentActiveWarId = this.normalizeString(data['currentActiveWarId']);
    const dominantExerciseTag = this.normalizeString(data['dominantExerciseTag']);
    const groupImage = this.normalizeString(data['groupImage']);
    const lastWarEndedAt = this.normalizeTimestamp(data['lastWarEndedAt']);
    const globalLeaderboardRank = this.toNonNegativeInteger(data['globalLeaderboardRank']);

    return {
      groupId: normalizedGroupId,
      name: this.normalizeString(data['name']) || 'Group',
      isPTGroup: data['isPTGroup'] === true,
      ownerUserId: this.normalizeString(data['ownerUserId']),
      created_at: this.normalizeTimestamp(data['created_at']) ?? Timestamp.now(),
      userIDs: this.normalizeStringArray(data['userIDs']),
      warOptIn: data['warOptIn'] === true,
      warEnabled: data['warEnabled'] === true,
      warRating: this.toFiniteNumber(data['warRating'], 1000),
      warWeight: this.toFiniteNumber(data['warWeight'], 1),
      totalWarLeaderboardPoints: this.toFiniteNumber(data['totalWarLeaderboardPoints'], 0),
      ...(globalLeaderboardRank > 0 ? { globalLeaderboardRank } : {}),
      wins: this.toNonNegativeInteger(data['wins']),
      losses: this.toNonNegativeInteger(data['losses']),
      ties: this.toNonNegativeInteger(data['ties']),
      ...(groupImage ? { groupImage } : {}),
      ...(currentActiveWarId ? { currentActiveWarId } : {}),
      ...(dominantExerciseTag ? { dominantExerciseTag } : {}),
      ...(lastWarEndedAt ? { lastWarEndedAt } : {}),
    };
  }

  private toGroupWarProfile(group: Group): GroupWarProfile {
    return {
      groupId: group.groupId,
      name: group.name,
      ownerUserId: group.ownerUserId,
      warOptIn: group.warOptIn,
      warEnabled: group.warEnabled,
      warRating: group.warRating,
      warWeight: group.warWeight,
      totalWarLeaderboardPoints: group.totalWarLeaderboardPoints,
      ...(typeof group.globalLeaderboardRank === 'number'
        ? { globalLeaderboardRank: group.globalLeaderboardRank }
        : {}),
      wins: group.wins,
      losses: group.losses,
      ties: group.ties,
      ...(group.currentActiveWarId ? { currentActiveWarId: group.currentActiveWarId } : {}),
      ...(group.dominantExerciseTag ? { dominantExerciseTag: group.dominantExerciseTag } : {}),
      ...(group.lastWarEndedAt ? { lastWarEndedAt: group.lastWarEndedAt } : {}),
    };
  }

  private normalizeString(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.normalizeString(entry))
      .filter((entry) => entry.length > 0);
  }

  private toFiniteNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toNonNegativeInteger(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.floor(parsed);
  }

  private normalizeTimestamp(value: unknown): Timestamp | undefined {
    if (value instanceof Timestamp) {
      return value;
    }
    return undefined;
  }
}
