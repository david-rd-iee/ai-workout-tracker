// src/app/services/leaderboard.service.ts
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  QueryConstraint,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { Observable, combineLatest, from, map, of, switchMap } from 'rxjs';
import {
  UserStats,
  Region,
  calculateUserLevelProgress,
} from '../models/user-stats.model';
import { UserService } from './account/user.service';
import { AppUser } from '../models/user.model';
import { ProfileRepositoryService } from './account/profile-repository.service';
import { watchDocumentData, watchQueryData } from './firestore-streams.util';

// 🔹 Shared metric type used by BOTH leaderboard page and groups page
export type Metric = 'total' | 'cardio' | 'strength';

// 🔹 Shared entry model
export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  rank: number;

  totalWorkScore: number;
  cardioWorkScore: number;
  strengthWorkScore: number;

  level?: number;
  region?: Region;

  // optional (useful for UI row)
  username?: string;
  profilePicUrl?: string;
  role?: 'USER' | 'TRAINER';
}

type RegionScope = 'country' | 'state' | 'city';

export interface RegionalQuery {
  scope: RegionScope;

  // required for any scope
  countryCode: string;

  // required if scope === 'state' or 'city'
  stateCode?: string;

  // required if scope === 'city'
  cityId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LeaderboardService {
  constructor(
    private firestore: Firestore,
    private userService: UserService,
    private profileRepository: ProfileRepositoryService
  ) {}

  // -----------------------------
  // Helpers
  // -----------------------------
  private metricToField(metric: Metric): keyof LeaderboardEntry {
    return metric === 'cardio'
      ? 'cardioWorkScore'
      : metric === 'strength'
      ? 'strengthWorkScore'
      : 'totalWorkScore';
  }

  private metricToFirestoreField(metric: Metric): string {
    return metric === 'cardio'
      ? 'cardioScore.totalCardioScore'
      : metric === 'strength'
      ? 'strengthScore.totalStrengthScore'
      : 'totalScore';
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private extractScoreTotals(stats: any): {
    cardioTotal: number;
    strengthTotal: number;
    total: number;
  } {
    const cardioTotal = this.toNumber(
      stats?.cardioScore?.totalCardioScore ??
      stats?.totalCardioScore ??
      stats?.cardioWorkScore ??
      stats?.cardio_work_score ??
      stats?.cardio_workScore ??
      0
    );

    const strengthTotal = this.toNumber(
      stats?.strengthScore?.totalStrengthScore ??
      stats?.workScore?.totalStrengthScore ??
      stats?.totalStrengthScore ??
      stats?.strengthWorkScore ??
      stats?.strength_work_score ??
      stats?.strength_workScore ??
      0
    );

    return {
      cardioTotal,
      strengthTotal,
      // totalScore is always derived from the two total map values
      total: cardioTotal + strengthTotal,
    };
  }

  private needsScoreSchemaInit(stats: any): boolean {
    const hasCardioMap = typeof stats?.cardioScore === 'object' && stats?.cardioScore !== null;
    const hasStrengthMap = typeof stats?.strengthScore === 'object' && stats?.strengthScore !== null;

    const cardioMapTotal = Number(stats?.cardioScore?.totalCardioScore);
    const strengthMapTotal = Number(stats?.strengthScore?.totalStrengthScore);
    const hasCardioMapTotal = Number.isFinite(cardioMapTotal);
    const hasStrengthMapTotal = Number.isFinite(strengthMapTotal);

    const totals = this.extractScoreTotals(stats);
    const totalScoreRaw = Number(stats?.totalScore);
    const hasTotalScore = Number.isFinite(totalScoreRaw);
    const totalMatches = hasTotalScore && totalScoreRaw === totals.total;
    const levelProgress = calculateUserLevelProgress(totals.total);
    const hasLevel = Number(stats?.level) === levelProgress.level;
    const hasPercentageOfLevel =
      Number(stats?.percentage_of_level) === levelProgress.percentage_of_level;

    return (
      !hasCardioMap ||
      !hasStrengthMap ||
      !hasCardioMapTotal ||
      !hasStrengthMapTotal ||
      !totalMatches ||
      !hasLevel ||
      !hasPercentageOfLevel
    );
  }

  private async ensureScoreSchema(userId: string, stats: any): Promise<void> {
    if (!userId || !stats || !this.needsScoreSchemaInit(stats)) {
      return;
    }

    const totals = this.extractScoreTotals(stats);
    const levelProgress = calculateUserLevelProgress(totals.total);
    const currentCardioMap =
      typeof stats?.cardioScore === 'object' && stats?.cardioScore !== null
        ? stats.cardioScore
        : {};
    const currentStrengthMap =
      typeof stats?.strengthScore === 'object' && stats?.strengthScore !== null
        ? stats.strengthScore
        : typeof stats?.workScore === 'object' && stats?.workScore !== null
        ? stats.workScore
        : {};

    await setDoc(
      doc(this.firestore, 'userStats', userId),
      {
        cardioScore: {
          ...currentCardioMap,
          totalCardioScore: totals.cardioTotal,
        },
        strengthScore: {
          ...currentStrengthMap,
          totalStrengthScore: totals.strengthTotal,
        },
        totalScore: totals.total,
        ...levelProgress,
      },
      { merge: true }
    );

    stats.cardioScore = {
      ...currentCardioMap,
      totalCardioScore: totals.cardioTotal,
    };
    stats.strengthScore = {
      ...currentStrengthMap,
      totalStrengthScore: totals.strengthTotal,
    };
    stats.totalScore = totals.total;
    stats.level = levelProgress.level;
    stats.percentage_of_level = levelProgress.percentage_of_level;
  }

  /**
   * Backwards-compatible score reads:
   * - New fields: cardioScore.totalCardioScore + strengthScore.totalStrengthScore + totalScore
   * - Old fields: total_work_score / cardio_work_score / strength_work_score
   */
  private readScores(stats: any): Pick<
    LeaderboardEntry,
    'totalWorkScore' | 'cardioWorkScore' | 'strengthWorkScore'
  > {
    const totals = this.extractScoreTotals(stats);

    return {
      totalWorkScore: totals.total,
      cardioWorkScore: totals.cardioTotal,
      strengthWorkScore: totals.strengthTotal,
    };
  }

  private readProfilePic(source: any): string | undefined {
    const candidates = [
      source?.profilePicUrl,
      source?.profilepic,
      source?.profilepicUrl,
      source?.avatarUrl,
    ];

    for (const value of candidates) {
      const raw = typeof value === 'string' ? value.trim() : '';
      if (raw.length > 0) return raw;
    }

    return undefined;
  }

  private readNonEmptyString(source: any, ...keys: string[]): string | undefined {
    for (const key of keys) {
      const raw = String(source?.[key] ?? '').trim();
      if (raw.length > 0) return raw;
    }
    return undefined;
  }

  private async hydrateEntriesFromUsers(entries: LeaderboardEntry[]): Promise<void> {
    const candidates = entries.filter((entry) => {
      const needsPic = !this.readProfilePic(entry);
      const needsName = !this.readNonEmptyString(entry, 'username', 'displayName');
      return needsPic || needsName || !entry.role;
    });

    await Promise.all(
      candidates.map(async (entry) => {
        const user = await this.userService.getUserSummaryDirectly(entry.userId);
        if (!user) return;
        this.applyUserSummaryToEntry(entry, user);
      })
    );
  }

  private applyUserSummaryToEntry(
    entry: LeaderboardEntry,
    user: AppUser | null | undefined
  ): LeaderboardEntry {
    if (!user) {
      return entry;
    }

    const userPic = this.readProfilePic(user);
    const userName = this.readNonEmptyString(user, 'username');
    const userEmail = this.readNonEmptyString(user, 'email');
    const statsName = this.readNonEmptyString(entry, 'displayName');

    if (!entry.profilePicUrl && userPic) {
      entry.profilePicUrl = userPic;
    }

    if (!entry.username && userName) {
      entry.username = userName;
    }

    if ((!statsName || statsName === 'Anonymous') && (userName || userEmail)) {
      entry.displayName = userName ?? userEmail ?? entry.displayName;
    }

    if (!entry.role && this.isTrainerRole({ isPT: user?.isPT, role: (user as any)?.role })) {
      entry.role = 'TRAINER';
    }

    return entry;
  }

  private buildEntryFromStats(userId: string, stats: any): LeaderboardEntry {
    const scores = this.readScores(stats);
    return {
      userId,
      displayName: stats?.displayName ?? stats?.username ?? 'Anonymous',
      rank: 0,
      ...scores,
      level: stats?.level,
      region: stats?.region,
      username: stats?.username,
      profilePicUrl: this.readProfilePic(stats),
      role: stats?.role,
    };
  }

  private normalizeUserIds(candidate: unknown): string[] {
    if (!Array.isArray(candidate)) {
      return [];
    }

    return Array.from(
      new Set(
        candidate
          .map((value) => String(value ?? '').trim())
          .filter((value) => value.length > 0)
      )
    );
  }

  private finalizeEntries(
    entries: LeaderboardEntry[],
    metric: Metric,
    maxResults: number = entries.length
  ): LeaderboardEntry[] {
    const metricField = this.metricToField(metric);

    const filteredEntries = entries
      .filter((entry) => !this.isTrainerRole(entry))
      .sort((a, b) => ((b as any)[metricField] ?? 0) - ((a as any)[metricField] ?? 0))
      .slice(0, maxResults);

    filteredEntries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return filteredEntries;
  }

  private buildRegionalFilterConstraints(regional: RegionalQuery): QueryConstraint[] {
    const filterConstraints: QueryConstraint[] = [
      where('region.countryCode', '==', regional.countryCode),
    ];

    if (regional.scope === 'state' || regional.scope === 'city') {
      filterConstraints.push(where('region.stateCode', '==', regional.stateCode!));
    }

    if (regional.scope === 'city') {
      filterConstraints.push(where('region.cityId', '==', regional.cityId!));
    }

    return filterConstraints;
  }

  private isTrainerRole(source: unknown): boolean {
    if (typeof source === 'boolean') {
      return source;
    }

    if (source && typeof source === 'object') {
      const candidate = source as { isPT?: unknown; role?: unknown };
      if (candidate.isPT === true) return true;
      const roleValue = String(candidate.role ?? '').trim().toLowerCase();
      return roleValue === 'trainer';
    }

    const value = String(source ?? '').trim().toLowerCase();
    return value === 'trainer';
  }

  // -----------------------------
  // Main leaderboard (all users)
  // -----------------------------
  getAllUserStats(): Observable<LeaderboardEntry[]> {
    const statsRef = collection(this.firestore, 'userStats');

    return watchQueryData<UserStats & { userId: string }>(statsRef, { idField: 'userId' }).pipe(
      map((docs) =>
        docs
          .filter((s: any) => !this.isTrainerRole(s))
          .map((s: any) => {
            void this.ensureScoreSchema(s.userId, s).catch((err) => {
              console.warn('[LeaderboardService] Failed to initialize score schema:', err);
            });
            return this.buildEntryFromStats(s.userId, s);
          })
      )
    );
  }

  watchGroupLeaderboard(groupId: string, metric: Metric = 'total'): Observable<LeaderboardEntry[]> {
    const normalizedGroupId = String(groupId ?? '').trim();
    if (!normalizedGroupId) {
      return of([]);
    }

    const groupRef = doc(this.firestore, 'groupID', normalizedGroupId);
    return watchDocumentData<{ userIDs?: string[] }>(groupRef).pipe(
      switchMap((group: any) => {
        const userIds = this.normalizeUserIds(group?.['userIDs']);
        if (userIds.length === 0) {
          return of([]);
        }

        const entryStreams = userIds.map((uid) =>
          combineLatest([
            watchDocumentData<UserStats>(doc(this.firestore, 'userStats', uid)),
            this.profileRepository.watchUserSummary(uid),
          ]).pipe(
            map(([stats, user]) => {
              if (!stats) {
                return null;
              }

              const entry = this.buildEntryFromStats(uid, stats);
              this.applyUserSummaryToEntry(entry, user);
              return this.isTrainerRole({ isPT: user?.isPT, role: entry.role })
                ? null
                : entry;
            })
          )
        );

        return combineLatest(entryStreams).pipe(
          map((entries) =>
            this.finalizeEntries(
              entries.filter((entry): entry is LeaderboardEntry => entry !== null),
              metric
            )
          )
        );
      })
    );
  }

  watchRegionalLeaderboard(
    regional: RegionalQuery,
    metric: Metric = 'total',
    maxResults: number = 100
  ): Observable<LeaderboardEntry[]> {
    const statsRef = collection(this.firestore, 'userStats');
    const regionalQuery = query(statsRef, ...this.buildRegionalFilterConstraints(regional));

    return watchQueryData<UserStats & { userId: string }>(regionalQuery, { idField: 'userId' }).pipe(
      switchMap((docs) =>
        from(
          this.hydrateRealtimeRegionalEntries(
            docs,
            metric,
            maxResults
          )
        )
      )
    );
  }

  private async hydrateRealtimeRegionalEntries(
    docs: (UserStats & { userId: string })[],
    metric: Metric,
    maxResults: number
  ): Promise<LeaderboardEntry[]> {
    const entries = docs.map((docEntry) => this.buildEntryFromStats(docEntry.userId, docEntry));
    await this.hydrateEntriesFromUsers(entries);
    return this.finalizeEntries(entries, metric, maxResults);
  }

  // -----------------------------
  // Regional leaderboard (NEW)
  // -----------------------------
  async getRegionalLeaderboard(
    regional: RegionalQuery,
    metric: Metric = 'total',
    maxResults: number = 100
  ): Promise<LeaderboardEntry[]> {
    console.log('[LeaderboardService] getRegionalLeaderboard', {
      regional,
      metric,
      maxResults,
    });

    const statsRef = collection(this.firestore, 'userStats');

    // Validate minimal requirements for scope
    if (!regional.countryCode) {
      throw new Error('countryCode is required for regional leaderboards.');
    }
    if ((regional.scope === 'state' || regional.scope === 'city') && !regional.stateCode) {
      throw new Error('stateCode is required when scope is state or city.');
    }
    if (regional.scope === 'city' && !regional.cityId) {
      throw new Error('cityId is required when scope is city.');
    }

    // Firestore field to orderBy
    const orderField = this.metricToFirestoreField(metric);

    // Build filter constraints
    const filterConstraints = this.buildRegionalFilterConstraints(regional);

    let entries: LeaderboardEntry[] = [];

    try {
      // Primary path: server-side sort + limit (requires composite indexes)
      const q = query(
        statsRef,
        ...filterConstraints,
        orderBy(orderField, 'desc'),
        fsLimit(maxResults)
      );
      const snap = await getDocs(q);
      entries = await Promise.all(
        snap.docs.map(async (d) => this.mapStatsDocToEntry(d.id, d.data()))
      );
    } catch (err: any) {
      if (!this.isMissingIndexError(err)) {
        throw err;
      }

      // Fallback path for dev/test projects without composite indexes:
      // fetch filtered rows, then sort/limit in-memory.
      console.warn(
        '[LeaderboardService] Missing composite index for regional query; using client-side sort fallback.'
      );
      const q = query(statsRef, ...filterConstraints);
      const snap = await getDocs(q);
      entries = await Promise.all(
        snap.docs.map(async (d) => this.mapStatsDocToEntry(d.id, d.data()))
      );
      const metricField = this.metricToField(metric);
      entries.sort((a, b) => ((b as any)[metricField] ?? 0) - ((a as any)[metricField] ?? 0));
      entries = entries.slice(0, maxResults);
    }

    await this.hydrateEntriesFromUsers(entries);
    entries = this.finalizeEntries(entries, metric, maxResults);

    console.log(
      '[LeaderboardService] regional entries:',
      entries.map((e) => ({
        uid: e.userId,
        total: e.totalWorkScore,
        cardio: e.cardioWorkScore,
        strength: e.strengthWorkScore,
      }))
    );

    return entries;
  }

  private async mapStatsDocToEntry(userId: string, stats: any): Promise<LeaderboardEntry> {
    await this.ensureScoreSchema(userId, stats);
    return this.buildEntryFromStats(userId, stats);
  }

  private isMissingIndexError(err: any): boolean {
    const message = String(err?.message ?? '').toLowerCase();
    return err?.code === 'failed-precondition' && message.includes('index');
  }

  // -----------------------------
  // Group leaderboard (existing)
  // -----------------------------
  async getGroupLeaderboard(
    groupId: string,
    metric: Metric = 'total'
  ): Promise<LeaderboardEntry[]> {
    console.log('[LeaderboardService] getGroupLeaderboard', { groupId, metric });

    // 1) Read group doc and use group.userIDs as the source of membership.
    const groupRef = doc(this.firestore, 'groupID', groupId);
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) {
      console.log('[LeaderboardService] Group not found:', groupId);
      return [];
    }

    const groupData = groupSnap.data() as { userIDs?: string[] };
    const userIds = Array.isArray(groupData.userIDs) ? groupData.userIDs : [];

    if (userIds.length === 0) {
      console.log('[LeaderboardService] Group has no userIDs:', groupId);
      return [];
    }

    // 2) For each userId, pull /users + /userStats docs
    const entries: LeaderboardEntry[] = [];

    await Promise.all(
      userIds.map(async (uid) => {
        const statsRef = doc(this.firestore, 'userStats', uid);
        const [user, statsSnap] = await Promise.all([
          this.userService.getUserSummaryDirectly(uid),
          getDoc(statsRef),
        ]);

        if (!statsSnap.exists()) {
          console.warn(
            '[LeaderboardService] No userStats doc for user in group:',
            uid
          );
          return;
        }

        const stats = statsSnap.data() as any;
        await this.ensureScoreSchema(uid, stats);

        const entry: LeaderboardEntry = {
          ...this.buildEntryFromStats(uid, stats),
          displayName:
            stats.displayName || user?.username || user?.email || 'Unknown User',
          username: stats.username ?? user?.username,
          profilePicUrl: this.readProfilePic(stats) ?? this.readProfilePic(user),
        };

        if (this.isTrainerRole({ isPT: user?.isPT ?? stats?.isPT, role: entry.role })) {
          return;
        }

        entries.push(entry);
      })
    );

    // 3) sort by the requested metric
    entries.splice(0, entries.length, ...this.finalizeEntries(entries, metric));

    console.log('[LeaderboardService] final sorted entries:', entries);
    return entries;
  }
}
