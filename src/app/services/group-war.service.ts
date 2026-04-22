import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  GroupLeaderboardEntry,
  GroupWar,
  GroupWarMemberStanding,
  GroupWarRecap,
  GroupWarStatus,
} from '../models/group-war.model';
import { GroupWarProfile } from './group.service';
import { watchQueryData } from './firestore-streams.util';
import { GroupWarStoreService } from './group-war-store.service';

type SuggestedMatchCandidate = GroupWarProfile & {
  isPTGroup: boolean;
};

@Injectable({
  providedIn: 'root',
})
export class GroupWarService {
  private readonly groupsCollectionName = 'groupID';
  private readonly pendingStatuses: GroupWarStatus[] = ['pending_confirmation', 'pending_acceptance'];
  private readonly activeStatuses: GroupWarStatus[] = ['active', 'finalizing'];
  private readonly historyStatuses: GroupWarStatus[] = ['finalized', 'declined', 'cancelled', 'expired'];

  constructor(
    private firestore: Firestore,
    private groupWarStore: GroupWarStoreService
  ) {}

  watchActiveWarForGroup(groupId: string): Observable<GroupWar | undefined> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      return of(undefined);
    }

    const warsRef = collection(this.firestore, GroupWarStoreService.GROUP_WARS_COLLECTION);
    const challengerQuery = query(
      warsRef,
      where('status', 'in', this.activeStatuses),
      where('challengerGroupId', '==', normalizedGroupId)
    );
    const opponentQuery = query(
      warsRef,
      where('status', 'in', this.activeStatuses),
      where('opponentGroupId', '==', normalizedGroupId)
    );

    return combineLatest([
      watchQueryData<Record<string, unknown>>(challengerQuery, { idField: 'warId' }),
      watchQueryData<Record<string, unknown>>(opponentQuery, { idField: 'warId' }),
    ]).pipe(
      map(([challengerRows, opponentRows]) => {
        const merged = this.mergeAndSortWars([...challengerRows, ...opponentRows]);
        return merged[0];
      })
    );
  }

  watchWarHistory(groupId: string, maxResults = 20): Observable<GroupWar[]> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      return of([]);
    }

    const warsRef = collection(this.firestore, GroupWarStoreService.GROUP_WARS_COLLECTION);
    const challengerQuery = query(
      warsRef,
      where('status', 'in', this.historyStatuses),
      where('challengerGroupId', '==', normalizedGroupId)
    );
    const opponentQuery = query(
      warsRef,
      where('status', 'in', this.historyStatuses),
      where('opponentGroupId', '==', normalizedGroupId)
    );

    return combineLatest([
      watchQueryData<Record<string, unknown>>(challengerQuery, { idField: 'warId' }),
      watchQueryData<Record<string, unknown>>(opponentQuery, { idField: 'warId' }),
    ]).pipe(
      map(([challengerRows, opponentRows]) =>
        this.mergeAndSortWars([...challengerRows, ...opponentRows]).slice(0, Math.max(1, maxResults))
      )
    );
  }

  watchPendingWarProposals(groupId: string, maxResults = 20): Observable<GroupWar[]> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      return of([]);
    }

    const warsRef = collection(this.firestore, GroupWarStoreService.GROUP_WARS_COLLECTION);
    const challengerQuery = query(
      warsRef,
      where('status', 'in', this.pendingStatuses),
      where('challengerGroupId', '==', normalizedGroupId)
    );
    const opponentQuery = query(
      warsRef,
      where('status', 'in', this.pendingStatuses),
      where('opponentGroupId', '==', normalizedGroupId)
    );

    return combineLatest([
      watchQueryData<Record<string, unknown>>(challengerQuery, { idField: 'warId' }),
      watchQueryData<Record<string, unknown>>(opponentQuery, { idField: 'warId' }),
    ]).pipe(
      map(([challengerRows, opponentRows]) =>
        this.mergeAndSortWars([...challengerRows, ...opponentRows]).slice(0, Math.max(1, maxResults))
      )
    );
  }

  async fetchSuggestedMatches(groupId: string, maxResults = 12): Promise<GroupWarProfile[]> {
    const normalizedGroupId = this.normalizeString(groupId);
    if (!normalizedGroupId) {
      return [];
    }

    const sourceGroupSnap = await getDoc(doc(this.firestore, this.groupsCollectionName, normalizedGroupId));
    if (!sourceGroupSnap.exists()) {
      return [];
    }

    const sourceGroup = this.toSuggestedMatchCandidate(
      normalizedGroupId,
      sourceGroupSnap.data() as Record<string, unknown>
    );
    const groupsRef = collection(this.firestore, this.groupsCollectionName);
    const candidatesQuery = query(
      groupsRef,
      where('warEnabled', '==', true),
      limit(Math.max(20, maxResults * 5))
    );
    const candidateSnap = await getDocs(candidatesQuery);
    const rows = candidateSnap.docs.map((snap) => ({
      groupId: snap.id,
      ...(snap.data() as Record<string, unknown>),
    }));
    const candidates = rows
      .map((row) => this.toSuggestedMatchCandidate(row['groupId'], row))
      .filter((candidate) => this.isSuggestedCandidate(sourceGroup, candidate));

    const sorted = candidates.sort((left, right) => {
      const leftWeightGap = Math.abs(left.warWeight - sourceGroup.warWeight);
      const rightWeightGap = Math.abs(right.warWeight - sourceGroup.warWeight);
      if (leftWeightGap !== rightWeightGap) {
        return leftWeightGap - rightWeightGap;
      }

      const tagMatchLeft = this.tagMatchScore(sourceGroup, left);
      const tagMatchRight = this.tagMatchScore(sourceGroup, right);
      if (tagMatchRight !== tagMatchLeft) {
        return tagMatchRight - tagMatchLeft;
      }

      const leftGap = Math.abs(left.warRating - sourceGroup.warRating);
      const rightGap = Math.abs(right.warRating - sourceGroup.warRating);
      if (leftGap !== rightGap) {
        return leftGap - rightGap;
      }

      return right.totalWarLeaderboardPoints - left.totalWarLeaderboardPoints;
    });

    return sorted.slice(0, Math.max(1, maxResults)).map((candidate) => this.toGroupWarProfile(candidate));
  }

  async acceptProposedWar(warId: string, ownerUid: string): Promise<void> {
    const normalizedWarId = this.normalizeString(warId);
    const normalizedOwnerUid = this.normalizeString(ownerUid);
    if (!normalizedWarId || !normalizedOwnerUid) {
      throw new Error('warId and ownerUid are required.');
    }

    const war = await this.getWarOnce(normalizedWarId);
    if (!war) {
      throw new Error('War not found.');
    }
    if (!this.pendingStatuses.includes(war.status)) {
      throw new Error('Only pending wars can be accepted.');
    }

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (war.challengerOwnerUid === normalizedOwnerUid) {
      updates['groupAAccepted'] = true;
    } else if (war.opponentOwnerUid === normalizedOwnerUid) {
      updates['groupBAccepted'] = true;
    } else {
      throw new Error('Only war owners can accept proposed wars.');
    }

    await updateDoc(doc(this.firestore, GroupWarStoreService.GROUP_WARS_COLLECTION, normalizedWarId), updates);
  }

  async declineProposedWar(warId: string, ownerUid: string): Promise<void> {
    const normalizedWarId = this.normalizeString(warId);
    const normalizedOwnerUid = this.normalizeString(ownerUid);
    if (!normalizedWarId || !normalizedOwnerUid) {
      throw new Error('warId and ownerUid are required.');
    }

    const war = await this.getWarOnce(normalizedWarId);
    if (!war) {
      throw new Error('War not found.');
    }
    if (!this.pendingStatuses.includes(war.status)) {
      throw new Error('Only pending wars can be declined.');
    }
    if (war.challengerOwnerUid !== normalizedOwnerUid && war.opponentOwnerUid !== normalizedOwnerUid) {
      throw new Error('Only war owners can decline proposed wars.');
    }

    const updates: Record<string, unknown> = {
      declinedBy: normalizedOwnerUid,
      declinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (war.challengerOwnerUid === normalizedOwnerUid) {
      updates['groupAAccepted'] = false;
    } else {
      updates['groupBAccepted'] = false;
    }

    await updateDoc(doc(this.firestore, GroupWarStoreService.GROUP_WARS_COLLECTION, normalizedWarId), updates);
  }

  watchGlobalGroupLeaderboard(maxResults = 100): Observable<GroupLeaderboardEntry[]> {
    const rankingsRef = collection(
      this.firestore,
      `${GroupWarStoreService.GROUP_LEADERBOARDS_COLLECTION}/${GroupWarStoreService.GROUP_LEADERBOARDS_GLOBAL_DOC_ID}/${GroupWarStoreService.GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION}`
    );
    const rankingsQuery = query(
      rankingsRef,
      orderBy('totalWarLeaderboardPoints', 'desc'),
      limit(Math.max(1, maxResults))
    );

    return watchQueryData<Record<string, unknown>>(rankingsQuery, { idField: 'groupId' }).pipe(
      map((rows) =>
        rows.map((row, index) => {
          const entry = this.buildGroupLeaderboardEntry(row['groupId'], row);
          if (entry.rank > 0) {
            return entry;
          }
          return { ...entry, rank: index + 1, globalLeaderboardRank: index + 1 };
        })
      )
    );
  }

  watchWarRecap(warId: string): Observable<GroupWarRecap | undefined> {
    return this.groupWarStore.watchWarRecapSummary(warId);
  }

  watchWarMemberStandings(warId: string, maxResults = 100): Observable<GroupWarMemberStanding[]> {
    const normalizedWarId = this.normalizeString(warId);
    if (!normalizedWarId) {
      return of([]);
    }

    const standingsRef = this.groupWarStore.warMembersCollectionRef(normalizedWarId);
    const standingsQuery = query(
      standingsRef,
      orderBy('normalizedWorkoutScoreTotal', 'desc'),
      orderBy('workoutCount', 'desc'),
      limit(Math.max(1, maxResults))
    );

    return watchQueryData<Record<string, unknown>>(standingsQuery, { idField: 'userId' }).pipe(
      map((rows) =>
        rows.map((row, index) => {
          const standing = this.buildGroupWarMemberStanding(row);
          if (standing.rank > 0) {
            return standing;
          }
          return {
            ...standing,
            rank: index + 1,
          };
        })
      )
    );
  }

  private async getWarOnce(warId: string): Promise<GroupWar | undefined> {
    const warSnap = await getDoc(doc(this.firestore, GroupWarStoreService.GROUP_WARS_COLLECTION, warId));
    if (!warSnap.exists()) {
      return undefined;
    }
    return this.buildGroupWar(warId, warSnap.data() as Record<string, unknown>);
  }

  private mergeAndSortWars(rows: Record<string, unknown>[]): GroupWar[] {
    const warsById = new Map<string, GroupWar>();
    rows.forEach((row) => {
      const warId = this.normalizeString(row['warId']);
      if (!warId) {
        return;
      }
      warsById.set(warId, this.buildGroupWar(warId, row));
    });

    return Array.from(warsById.values()).sort((left, right) => {
      const leftTime = this.toMillis(
        left.finalizedAt ?? left.endsAt ?? left.activatedAt ?? left.updatedAt ?? left.createdAt
      );
      const rightTime = this.toMillis(
        right.finalizedAt ?? right.endsAt ?? right.activatedAt ?? right.updatedAt ?? right.createdAt
      );
      return rightTime - leftTime;
    });
  }

  private buildGroupWar(warId: unknown, data: Record<string, unknown>): GroupWar {
    const normalizedWarId = this.normalizeString(warId);
    const status = this.normalizeWarStatus(data['status']);
    const startAt = this.normalizeTimestamp(data['startAt'] ?? data['activatedAt']);
    const endAt = this.normalizeTimestamp(data['endAt'] ?? data['endsAt']);
    const challengerAcceptedAt = this.normalizeTimestamp(data['challengerAcceptedAt']);
    const opponentAcceptedAt = this.normalizeTimestamp(data['opponentAcceptedAt']);
    const groupAAccepted =
      data['groupAAccepted'] === true || !!challengerAcceptedAt;
    const groupBAccepted =
      data['groupBAccepted'] === true || !!opponentAcceptedAt;

    return {
      warId: normalizedWarId,
      ...(this.normalizeString(data['groupAId']) ? { groupAId: this.normalizeString(data['groupAId']) } : {}),
      ...(this.normalizeString(data['groupBId']) ? { groupBId: this.normalizeString(data['groupBId']) } : {}),
      challengerGroupId: this.normalizeString(data['challengerGroupId'] ?? data['groupAId']),
      opponentGroupId: this.normalizeString(data['opponentGroupId'] ?? data['groupBId']),
      challengerOwnerUid: this.normalizeString(data['challengerOwnerUid']),
      opponentOwnerUid: this.normalizeString(data['opponentOwnerUid']),
      groupAAccepted,
      groupBAccepted,
      ...(this.normalizeTimestamp(data['acceptedAt'])
        ? { acceptedAt: this.normalizeTimestamp(data['acceptedAt'])! }
        : {}),
      ...(startAt ? { startAt } : {}),
      ...(endAt ? { endAt } : {}),
      ...(challengerAcceptedAt ? { challengerAcceptedAt } : {}),
      ...(opponentAcceptedAt ? { opponentAcceptedAt } : {}),
      status,
      ...(startAt ? { activatedAt: startAt } : {}),
      ...(endAt ? { endsAt: endAt } : {}),
      ...(this.normalizeTimestamp(data['finalizedAt'])
        ? { finalizedAt: this.normalizeTimestamp(data['finalizedAt'])! }
        : {}),
      challengerScoreTotal: this.toFiniteNumber(data['challengerScoreTotal']),
      opponentScoreTotal: this.toFiniteNumber(data['opponentScoreTotal']),
      ...(this.isFiniteNumber(data['groupAPoints']) ? { groupAPoints: this.toFiniteNumber(data['groupAPoints']) } : {}),
      ...(this.isFiniteNumber(data['groupBPoints']) ? { groupBPoints: this.toFiniteNumber(data['groupBPoints']) } : {}),
      ...(this.isFiniteNumber(data['groupACardioPoints'])
        ? { groupACardioPoints: this.toFiniteNumber(data['groupACardioPoints']) }
        : {}),
      ...(this.isFiniteNumber(data['groupAStrengthPoints'])
        ? { groupAStrengthPoints: this.toFiniteNumber(data['groupAStrengthPoints']) }
        : {}),
      ...(this.isFiniteNumber(data['groupBCardioPoints'])
        ? { groupBCardioPoints: this.toFiniteNumber(data['groupBCardioPoints']) }
        : {}),
      ...(this.isFiniteNumber(data['groupBStrengthPoints'])
        ? { groupBStrengthPoints: this.toFiniteNumber(data['groupBStrengthPoints']) }
        : {}),
      ...(this.normalizeWarResult(data['result']) ? { result: this.normalizeWarResult(data['result'])! } : {}),
      leaderboardPointsAwarded: data['leaderboardPointsAwarded'] === true,
      ...(this.isFiniteNumber(data['challengerPointsAwarded'])
        ? { challengerPointsAwarded: this.toFiniteNumber(data['challengerPointsAwarded']) }
        : {}),
      ...(this.isFiniteNumber(data['opponentPointsAwarded'])
        ? { opponentPointsAwarded: this.toFiniteNumber(data['opponentPointsAwarded']) }
        : {}),
      challengerMemberUserIdsAtStart: this.normalizeStringArray(data['challengerMemberUserIdsAtStart']),
      opponentMemberUserIdsAtStart: this.normalizeStringArray(data['opponentMemberUserIdsAtStart']),
      createdAt: this.normalizeTimestamp(data['createdAt']) ?? Timestamp.now(),
      updatedAt: this.normalizeTimestamp(data['updatedAt']) ?? Timestamp.now(),
    };
  }

  private buildGroupLeaderboardEntry(groupId: unknown, data: Record<string, unknown>): GroupLeaderboardEntry {
    const normalizedGroupId = this.normalizeString(groupId);
    const groupImage = this.normalizeString(data['groupImage']);
    const dominantExerciseTag = this.normalizeString(data['dominantExerciseTag']);
    const currentActiveWarId = this.normalizeString(data['currentActiveWarId']);
    const lastWarEndedAt = this.normalizeTimestamp(data['lastWarEndedAt']);
    const resolvedRank = this.toNonNegativeInteger(data['rank'] ?? data['globalLeaderboardRank']);

    return {
      groupId: normalizedGroupId,
      groupName: this.normalizeString(data['groupName']) || 'Group',
      rank: resolvedRank,
      ...(resolvedRank > 0 ? { globalLeaderboardRank: resolvedRank } : {}),
      totalWarLeaderboardPoints: this.toFiniteNumber(data['totalWarLeaderboardPoints']),
      warRating: this.toFiniteNumber(data['warRating'], 1000),
      warWeight: this.toFiniteNumber(data['warWeight'], 1),
      wins: this.toNonNegativeInteger(data['wins']),
      losses: this.toNonNegativeInteger(data['losses']),
      ties: this.toNonNegativeInteger(data['ties']),
      ...(groupImage ? { groupImage } : {}),
      ...(dominantExerciseTag ? { dominantExerciseTag } : {}),
      ...(currentActiveWarId ? { currentActiveWarId } : {}),
      ...(lastWarEndedAt ? { lastWarEndedAt } : {}),
    };
  }

  private buildGroupWarMemberStanding(data: Record<string, unknown>): GroupWarMemberStanding {
    const profilePicUrl = this.normalizeString(data['profilePicUrl']);
    const topExerciseTag = this.normalizeString(data['topExerciseTag']);
    const exerciseContributionTotals = this.normalizeNumberMap(
      data['exerciseContributionTotals'] ?? data['exerciseTotals']
    );
    const lastContributionAt = this.normalizeTimestamp(data['lastContributionAt']);

    return {
      warId: this.normalizeString(data['warId']),
      groupId: this.normalizeString(data['groupId']),
      userId: this.normalizeString(data['userId']),
      displayName: this.normalizeString(data['displayName']) || 'Member',
      ...(profilePicUrl ? { profilePicUrl } : {}),
      normalizedWorkoutScoreTotal: this.toFiniteNumber(data['normalizedWorkoutScoreTotal'] ?? data['totalContribution']),
      ...(this.isFiniteNumber(data['totalContribution'])
        ? { totalContribution: this.toFiniteNumber(data['totalContribution']) }
        : {}),
      ...(this.isFiniteNumber(data['cardioContributionTotal'])
        ? { cardioContributionTotal: this.toFiniteNumber(data['cardioContributionTotal']) }
        : {}),
      ...(this.isFiniteNumber(data['strengthContributionTotal'])
        ? { strengthContributionTotal: this.toFiniteNumber(data['strengthContributionTotal']) }
        : {}),
      ...(Object.keys(exerciseContributionTotals).length > 0
        ? { exerciseContributionTotals }
        : {}),
      ...(topExerciseTag ? { topExerciseTag } : {}),
      ...(lastContributionAt ? { lastContributionAt } : {}),
      workoutCount: this.toNonNegativeInteger(data['workoutCount']),
      rank: this.toNonNegativeInteger(data['rank']),
    };
  }

  private toSuggestedMatchCandidate(
    groupId: unknown,
    data: Record<string, unknown>
  ): SuggestedMatchCandidate {
    return {
      groupId: this.normalizeString(groupId),
      name: this.normalizeString(data['name']) || 'Group',
      ownerUserId: this.normalizeString(data['ownerUserId']),
      warOptIn: data['warOptIn'] === true,
      warEnabled: data['warEnabled'] === true,
      warRating: this.toFiniteNumber(data['warRating'], 1000),
      warWeight: this.toFiniteNumber(data['warWeight'], 1),
      totalWarLeaderboardPoints: this.toFiniteNumber(data['totalWarLeaderboardPoints']),
      ...(this.toNonNegativeInteger(data['globalLeaderboardRank']) > 0
        ? { globalLeaderboardRank: this.toNonNegativeInteger(data['globalLeaderboardRank']) }
        : {}),
      wins: this.toNonNegativeInteger(data['wins']),
      losses: this.toNonNegativeInteger(data['losses']),
      ties: this.toNonNegativeInteger(data['ties']),
      isPTGroup: data['isPTGroup'] === true,
      ...(this.normalizeString(data['currentActiveWarId'])
        ? { currentActiveWarId: this.normalizeString(data['currentActiveWarId']) }
        : {}),
      ...(this.normalizeString(data['dominantExerciseTag'])
        ? { dominantExerciseTag: this.normalizeString(data['dominantExerciseTag']) }
        : {}),
      ...(this.normalizeTimestamp(data['lastWarEndedAt'])
        ? { lastWarEndedAt: this.normalizeTimestamp(data['lastWarEndedAt'])! }
        : {}),
    };
  }

  private toGroupWarProfile(candidate: SuggestedMatchCandidate): GroupWarProfile {
    return {
      groupId: candidate.groupId,
      name: candidate.name,
      ownerUserId: candidate.ownerUserId,
      warOptIn: candidate.warOptIn,
      warEnabled: candidate.warEnabled,
      warRating: candidate.warRating,
      warWeight: candidate.warWeight,
      totalWarLeaderboardPoints: candidate.totalWarLeaderboardPoints,
      ...(typeof candidate.globalLeaderboardRank === 'number'
        ? { globalLeaderboardRank: candidate.globalLeaderboardRank }
        : {}),
      wins: candidate.wins,
      losses: candidate.losses,
      ties: candidate.ties,
      ...(candidate.currentActiveWarId ? { currentActiveWarId: candidate.currentActiveWarId } : {}),
      ...(candidate.dominantExerciseTag ? { dominantExerciseTag: candidate.dominantExerciseTag } : {}),
      ...(candidate.lastWarEndedAt ? { lastWarEndedAt: candidate.lastWarEndedAt } : {}),
    };
  }

  private isSuggestedCandidate(source: SuggestedMatchCandidate, candidate: SuggestedMatchCandidate): boolean {
    if (!candidate.groupId || candidate.groupId === source.groupId) {
      return false;
    }
    if (candidate.isPTGroup) {
      return false;
    }
    if (!candidate.warEnabled || !candidate.warOptIn) {
      return false;
    }
    if (!!candidate.currentActiveWarId) {
      return false;
    }
    return true;
  }

  private tagMatchScore(source: SuggestedMatchCandidate, candidate: SuggestedMatchCandidate): number {
    if (!source.dominantExerciseTag || !candidate.dominantExerciseTag) {
      return 0;
    }
    return source.dominantExerciseTag === candidate.dominantExerciseTag ? 1 : 0;
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

  private normalizeNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const normalized: Record<string, number> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
      const normalizedKey = this.normalizeString(key);
      const normalizedValue = this.toFiniteNumber(raw);
      if (!normalizedKey || normalizedValue <= 0) {
        return;
      }
      normalized[normalizedKey] = normalizedValue;
    });

    return normalized;
  }

  private normalizeTimestamp(value: unknown): Timestamp | undefined {
    if (value instanceof Timestamp) {
      return value;
    }
    return undefined;
  }

  private normalizeWarStatus(value: unknown): GroupWarStatus {
    const normalized = this.normalizeString(value) as GroupWarStatus;
    const statuses: GroupWarStatus[] = [
      'pending_confirmation',
      'pending_acceptance',
      'active',
      'finalizing',
      'finalized',
      'declined',
      'cancelled',
      'expired',
    ];
    return statuses.includes(normalized) ? normalized : 'pending_confirmation';
  }

  private normalizeWarResult(value: unknown): GroupWar['result'] | undefined {
    const normalized = this.normalizeString(value) as GroupWar['result'];
    if (normalized === 'challenger_win' || normalized === 'opponent_win' || normalized === 'tie') {
      return normalized;
    }
    return undefined;
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

  private isFiniteNumber(value: unknown): boolean {
    return Number.isFinite(Number(value));
  }

  private toMillis(value: Timestamp | undefined): number {
    if (!value) {
      return 0;
    }
    return value.toMillis();
  }
}
