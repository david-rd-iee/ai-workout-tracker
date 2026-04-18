// src/app/services/leaderboard.service.ts
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  QueryConstraint,
  collection,
  deleteField,
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
  normalizeUserScore,
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
  trainerVerified?: boolean;
}

export interface LeaderboardTrendPoint {
  name: string;
  value: number;
}

export interface LeaderboardTrendSeries {
  userId: string;
  name: string;
  series: LeaderboardTrendPoint[];
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
      ? 'userScore.cardioScore.totalCardioScore'
      : metric === 'strength'
      ? 'userScore.strengthScore.totalStrengthScore'
      : 'userScore.totalScore';
  }

  private metricToAddedScoreField(metric: Metric): string {
    return metric === 'cardio'
      ? 'cardioScoreAddedToday'
      : metric === 'strength'
      ? 'strengthScoreAddedToday'
      : 'totalScoreAddedToday';
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  private extractScoreTotals(stats: any): {
    cardioTotal: number;
    strengthTotal: number;
    total: number;
  } {
    const userScore = normalizeUserScore(
      stats?.userScore,
      stats?.cardioScore,
      stats?.strengthScore,
      stats?.totalScore,
      stats?.workScore
    );
    const cardioTotal = this.toNumber(
      userScore.cardioScore.totalCardioScore ??
      stats?.totalCardioScore ??
      stats?.cardioWorkScore ??
      stats?.cardio_work_score ??
      stats?.cardio_workScore ??
      0
    );

    const strengthTotal = this.toNumber(
      userScore.strengthScore.totalStrengthScore ??
      stats?.totalStrengthScore ??
      stats?.strengthWorkScore ??
      stats?.strength_work_score ??
      stats?.strength_workScore ??
      0
    );

    return {
      cardioTotal,
      strengthTotal,
      total: cardioTotal + strengthTotal,
    };
  }

  private needsScoreSchemaInit(stats: any): boolean {
    const hasUserScoreMap =
      typeof stats?.userScore === 'object' &&
      stats?.userScore !== null &&
      typeof stats?.userScore?.cardioScore === 'object' &&
      stats?.userScore?.cardioScore !== null &&
      typeof stats?.userScore?.strengthScore === 'object' &&
      stats?.userScore?.strengthScore !== null;

    const cardioMapTotal = Number(stats?.userScore?.cardioScore?.totalCardioScore);
    const strengthMapTotal = Number(stats?.userScore?.strengthScore?.totalStrengthScore);
    const hasCardioMapTotal = Number.isFinite(cardioMapTotal);
    const hasStrengthMapTotal = Number.isFinite(strengthMapTotal);

    const totals = this.extractScoreTotals(stats);
    const totalScoreRaw = Number(stats?.userScore?.totalScore);
    const hasTotalScore = Number.isFinite(totalScoreRaw);
    const totalMatches = hasTotalScore && totalScoreRaw === totals.total;
    const hasMaxAddedScoreWithinDay = Number.isFinite(Number(stats?.userScore?.maxAddedScoreWithinDay));
    const levelProgress = calculateUserLevelProgress(totals.total);
    const hasLevel = Number(stats?.level) === levelProgress.level;
    const hasPercentageOfLevel =
      Number(stats?.percentage_of_level) === levelProgress.percentage_of_level;
    const hasLegacyTopLevelScores =
      Object.prototype.hasOwnProperty.call(stats ?? {}, 'cardioScore') ||
      Object.prototype.hasOwnProperty.call(stats ?? {}, 'strengthScore') ||
      Object.prototype.hasOwnProperty.call(stats ?? {}, 'totalScore') ||
      Object.prototype.hasOwnProperty.call(stats ?? {}, 'workScore');

    return (
      !hasUserScoreMap ||
      !hasCardioMapTotal ||
      !hasStrengthMapTotal ||
      !hasMaxAddedScoreWithinDay ||
      !totalMatches ||
      hasLegacyTopLevelScores ||
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
    const normalizedUserScore = normalizeUserScore(
      stats?.userScore,
      stats?.cardioScore,
      stats?.strengthScore,
      stats?.totalScore,
      stats?.workScore
    );

    await setDoc(
      doc(this.firestore, 'userStats', userId),
      {
        userScore: {
          ...normalizedUserScore,
          totalScore: totals.total,
        },
        cardioScore: deleteField(),
        strengthScore: deleteField(),
        totalScore: deleteField(),
        workScore: deleteField(),
        ...levelProgress,
      },
      { merge: true }
    );

    stats.userScore = {
      ...normalizedUserScore,
      totalScore: totals.total,
    };
    delete stats.cardioScore;
    delete stats.strengthScore;
    delete stats.totalScore;
    delete stats.workScore;
    stats.level = levelProgress.level;
    stats.percentage_of_level = levelProgress.percentage_of_level;
  }

  /**
   * Backwards-compatible score reads:
   * - New fields: userScore.cardioScore.totalCardioScore + userScore.strengthScore.totalStrengthScore + userScore.totalScore
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
      trainerVerified: this.toBoolean(stats?.trainerVerified),
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

  private scoreForMetric(entry: LeaderboardEntry, metric: Metric): number {
    if (metric === 'cardio') return this.toNumber(entry.cardioWorkScore);
    if (metric === 'strength') return this.toNumber(entry.strengthWorkScore);
    return this.toNumber(entry.totalWorkScore);
  }

  private toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private shiftDateKey(dateKey: string, dayDelta: number): string {
    if (!dateKey || !Number.isFinite(dayDelta)) {
      return dateKey;
    }

    const parsed = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return dateKey;
    }

    parsed.setDate(parsed.getDate() + Math.trunc(dayDelta));
    return this.toLocalDateKey(parsed);
  }

  private normalizeDateKey(value: unknown): string {
    const candidate = String(value ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return candidate;
    }
    return '';
  }

  private sortDateKeys(keys: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(keys).filter((key) => key.length > 0))).sort();
  }

  private buildTrendSeriesForEntries(
    rows: Array<{
      entry: LeaderboardEntry;
      points: Array<{ dateKey: string; value: number }>;
    }>,
    metric: Metric
  ): LeaderboardTrendSeries[] {
    const allDateKeys = this.sortDateKeys(
      rows.reduce<string[]>((accumulator, row) => {
        row.points.forEach((point) => {
          accumulator.push(point.dateKey);
        });
        return accumulator;
      }, [])
    );
    const today = this.toLocalDateKey(new Date());
    const baselineDateKeys = allDateKeys.length > 0 ? allDateKeys : [today];
    const baselineStart = baselineDateKeys[0];
    const baselineEnd = baselineDateKeys[baselineDateKeys.length - 1];
    const fallbackStart = baselineStart === baselineEnd
      ? this.shiftDateKey(baselineStart, -1)
      : baselineStart;

    return rows.map((row) => {
      const label = this.readNonEmptyString(row.entry, 'username', 'displayName') ?? 'User';
      if (row.points.length === 0) {
        const currentScore = this.scoreForMetric(row.entry, metric);
        return {
          userId: row.entry.userId,
          name: label,
          series: [
            { name: fallbackStart, value: currentScore },
            { name: baselineEnd, value: currentScore },
          ],
        };
      }

      const valueByDate = new Map<string, number>();
      row.points.forEach((point) => {
        valueByDate.set(point.dateKey, this.toNumber(point.value));
      });

      return {
        userId: row.entry.userId,
        name: label,
        series: baselineDateKeys.map((dateKey) => ({
          name: dateKey,
          value: valueByDate.get(dateKey) ?? 0,
        })),
      };
    });
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

  watchAddedScoreTrend(
    entries: LeaderboardEntry[],
    metric: Metric = 'total'
  ): Observable<LeaderboardTrendSeries[]> {
    const uniqueEntries = entries.reduce<LeaderboardEntry[]>((accumulator, entry) => {
      if (!entry?.userId || accumulator.some((candidate) => candidate.userId === entry.userId)) {
        return accumulator;
      }
      accumulator.push(entry);
      return accumulator;
    }, []);

    if (uniqueEntries.length === 0) {
      return of([]);
    }

    const addedScoreField = this.metricToAddedScoreField(metric);
    const entryStreams = uniqueEntries.map((entry) => {
      const addedScoreRef = collection(this.firestore, 'userStats', entry.userId, 'addedScore');
      const addedScoreQuery = query(addedScoreRef, orderBy('date', 'asc'));

      return watchQueryData<Record<string, unknown> & { docId?: string }>(
        addedScoreQuery,
        { idField: 'docId' }
      ).pipe(
        map((docs) => ({
          entry,
          points: docs
            .map((docEntry) => ({
              dateKey: this.normalizeDateKey(docEntry['date'] ?? docEntry['docId']),
              value: this.toNumber(docEntry[addedScoreField]),
            }))
            .filter((point) => point.dateKey.length > 0),
        }))
      );
    });

    return combineLatest(entryStreams).pipe(
      map((rows) => this.buildTrendSeriesForEntries(rows, metric))
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
