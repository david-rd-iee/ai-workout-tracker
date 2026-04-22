import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import {
  GroupLeaderboardEntry,
  GroupWar,
  GroupWarContribution,
  GroupWarMemberStanding,
  GroupWarRecap,
} from '../models/group-war.model';
import { watchDocumentData, watchQueryData } from './firestore-streams.util';

@Injectable({
  providedIn: 'root',
})
export class GroupWarStoreService {
  static readonly GROUP_WARS_COLLECTION = 'groupWars';
  static readonly WAR_CONTRIBUTIONS_SUBCOLLECTION = 'contributions';
  static readonly WAR_MEMBERS_SUBCOLLECTION = 'members';
  static readonly WAR_RECAP_SUBCOLLECTION = 'recap';
  static readonly WAR_RECAP_SUMMARY_DOC_ID = 'summary';

  static readonly GROUP_LEADERBOARDS_COLLECTION = 'groupLeaderboards';
  static readonly GROUP_LEADERBOARDS_GLOBAL_DOC_ID = 'global';
  static readonly GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION = 'rankings';

  constructor(private firestore: Firestore) {}

  // Path helpers (exact Firestore paths requested)
  pathForWar(warId: string): string {
    return `${GroupWarStoreService.GROUP_WARS_COLLECTION}/${this.requireId(warId, 'warId')}`;
  }

  pathForWarContribution(warId: string, contributionId: string): string {
    return `${this.pathForWar(warId)}/${GroupWarStoreService.WAR_CONTRIBUTIONS_SUBCOLLECTION}/${this.requireId(contributionId, 'contributionId')}`;
  }

  pathForWarMember(warId: string, userId: string): string {
    return `${this.pathForWar(warId)}/${GroupWarStoreService.WAR_MEMBERS_SUBCOLLECTION}/${this.requireId(userId, 'userId')}`;
  }

  pathForGlobalGroupRanking(groupId: string): string {
    return `${GroupWarStoreService.GROUP_LEADERBOARDS_COLLECTION}/${GroupWarStoreService.GROUP_LEADERBOARDS_GLOBAL_DOC_ID}/${GroupWarStoreService.GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION}/${this.requireId(groupId, 'groupId')}`;
  }

  pathForWarRecapSummary(warId: string): string {
    return `${this.pathForWar(warId)}/${GroupWarStoreService.WAR_RECAP_SUBCOLLECTION}/${GroupWarStoreService.WAR_RECAP_SUMMARY_DOC_ID}`;
  }

  // Typed references
  warRef(warId: string) {
    return doc(this.firestore, this.pathForWar(warId));
  }

  warContributionsCollectionRef(warId: string) {
    return collection(
      this.firestore,
      `${this.pathForWar(warId)}/${GroupWarStoreService.WAR_CONTRIBUTIONS_SUBCOLLECTION}`
    );
  }

  warContributionRef(warId: string, contributionId: string) {
    return doc(this.firestore, this.pathForWarContribution(warId, contributionId));
  }

  warMembersCollectionRef(warId: string) {
    return collection(
      this.firestore,
      `${this.pathForWar(warId)}/${GroupWarStoreService.WAR_MEMBERS_SUBCOLLECTION}`
    );
  }

  warMemberRef(warId: string, userId: string) {
    return doc(this.firestore, this.pathForWarMember(warId, userId));
  }

  globalGroupRankingRef(groupId: string) {
    return doc(this.firestore, this.pathForGlobalGroupRanking(groupId));
  }

  warRecapSummaryRef(warId: string) {
    return doc(this.firestore, this.pathForWarRecapSummary(warId));
  }

  // Writes
  async upsertWar(warId: string, payload: Partial<GroupWar>): Promise<void> {
    await setDoc(
      this.warRef(warId),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async upsertWarContribution(
    warId: string,
    contributionId: string,
    payload: Partial<GroupWarContribution>
  ): Promise<void> {
    await setDoc(
      this.warContributionRef(warId, contributionId),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async upsertWarMemberStanding(
    warId: string,
    userId: string,
    payload: Partial<GroupWarMemberStanding>
  ): Promise<void> {
    await setDoc(
      this.warMemberRef(warId, userId),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async upsertGlobalGroupLeaderboardEntry(
    groupId: string,
    payload: Partial<GroupLeaderboardEntry>
  ): Promise<void> {
    await setDoc(
      this.globalGroupRankingRef(groupId),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async upsertWarRecapSummary(
    warId: string,
    payload: Partial<GroupWarRecap>
  ): Promise<void> {
    await setDoc(
      this.warRecapSummaryRef(warId),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  // Reads
  watchWar(warId: string): Observable<GroupWar | undefined> {
    return watchDocumentData<GroupWar>(this.warRef(warId));
  }

  watchWarMembers(warId: string): Observable<GroupWarMemberStanding[]> {
    return watchQueryData<GroupWarMemberStanding>(this.warMembersCollectionRef(warId));
  }

  watchWarRecapSummary(warId: string): Observable<GroupWarRecap | undefined> {
    return watchDocumentData<GroupWarRecap>(this.warRecapSummaryRef(warId));
  }

  watchGlobalGroupLeaderboard(): Observable<GroupLeaderboardEntry[]> {
    return watchQueryData<GroupLeaderboardEntry>(
      collection(
        this.firestore,
        `${GroupWarStoreService.GROUP_LEADERBOARDS_COLLECTION}/${GroupWarStoreService.GROUP_LEADERBOARDS_GLOBAL_DOC_ID}/${GroupWarStoreService.GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION}`
      )
    );
  }

  private requireId(value: string, label: string): string {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) {
      throw new Error(`${label} is required.`);
    }
    return normalizedValue;
  }
}
