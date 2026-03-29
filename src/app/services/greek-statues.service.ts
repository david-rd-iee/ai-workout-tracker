import { Injectable, Signal, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import {
  buildStatueTiersFromLevelingConstant,
  DEFAULT_STATUE_STAGE_IMAGES,
  GreekStatueDefinition,
  StatueCategory,
  StatueLevel,
  STATUE_LEVELS,
} from '../models/greek-statue.model';

@Injectable({
  providedIn: 'root',
})
export class GreekStatuesService {
  private static readonly COLLECTION_NAME = 'GreekStatues';
  private static readonly BOOTSTRAP_DOC_ID = '__meta__';

  private readonly currentGreekStatues = signal<GreekStatueDefinition[]>([]);
  private collectionUnsubscribe: (() => void) | null = null;
  private initialSnapshotPromise: Promise<void> | null = null;
  private resolveInitialSnapshot: (() => void) | null = null;
  private hasLoadedSnapshot = false;

  constructor(private readonly firestore: Firestore) {}

  getCurrentGreekStatues(): Signal<GreekStatueDefinition[]> {
    this.ensureCollectionListener();
    return this.currentGreekStatues;
  }

  async getGreekStatues(forceRefresh = false): Promise<GreekStatueDefinition[]> {
    this.ensureCollectionListener();

    if (forceRefresh) {
      const statues = await this.fetchGreekStatues();
      this.currentGreekStatues.set(this.cloneGreekStatues(statues));
      this.hasLoadedSnapshot = true;
      return this.cloneGreekStatues(statues);
    }

    if (!this.hasLoadedSnapshot && this.initialSnapshotPromise) {
      await this.initialSnapshotPromise;
    }

    return this.cloneGreekStatues(this.currentGreekStatues());
  }

  private ensureCollectionListener(): void {
    if (this.collectionUnsubscribe) {
      return;
    }

    if (!this.initialSnapshotPromise) {
      this.initialSnapshotPromise = new Promise<void>((resolve) => {
        this.resolveInitialSnapshot = resolve;
      });
    }

    const statuesRef = collection(this.firestore, GreekStatuesService.COLLECTION_NAME);
    this.collectionUnsubscribe = onSnapshot(
      statuesRef,
      (snapshot) => {
        const statues = snapshot.docs
          .filter((docSnap) => docSnap.id !== GreekStatuesService.BOOTSTRAP_DOC_ID)
          .map((docSnap) => this.normalizeGreekStatueDoc(docSnap.id, docSnap.data()));

        this.currentGreekStatues.set(this.cloneGreekStatues(statues));
        this.hasLoadedSnapshot = true;
        this.resolveInitialSnapshot?.();
        this.resolveInitialSnapshot = null;
      },
      (error) => {
        console.error('[GreekStatuesService] Failed to observe GreekStatues:', error);
        this.hasLoadedSnapshot = true;
        this.resolveInitialSnapshot?.();
        this.resolveInitialSnapshot = null;
      }
    );
  }

  private async fetchGreekStatues(): Promise<GreekStatueDefinition[]> {
    try {
      const snapshot = await getDocs(
        collection(this.firestore, GreekStatuesService.COLLECTION_NAME)
      );
      return snapshot.docs
        .filter((docSnap) => docSnap.id !== GreekStatuesService.BOOTSTRAP_DOC_ID)
        .map((docSnap) => this.normalizeGreekStatueDoc(docSnap.id, docSnap.data()));
    } catch (error) {
      console.error('[GreekStatuesService] Failed to load GreekStatues:', error);
      return [];
    }
  }

  private normalizeGreekStatueDoc(
    docId: string,
    data: Record<string, unknown> | undefined
  ): GreekStatueDefinition {
    const raw = data ?? {};
    const normalizedTiers = this.normalizeTierMap(raw['tiers']);
    const levelingConstant = this.normalizeLevelingConstant(raw['levelingConstant'], normalizedTiers);

    return {
      id: this.readText(raw['id']) || docId,
      godName: this.readText(raw['godName']) || docId,
      title: this.readText(raw['title']) || 'Statue',
      icon: this.readText(raw['icon']) || 'fitness',
      customIcon: this.readText(raw['customIcon']) || undefined,
      description: this.readText(raw['description']) || '',
      category: this.normalizeCategory(raw['category']),
      metric: this.readText(raw['metric']),
      unit: this.readText(raw['unit']) || undefined,
      mythology: this.readText(raw['mythology']) || '',
      levelingConstant,
      stageImages: this.normalizeStageImages(raw['stageImages']),
      tiers: this.hasPositiveTierValue(normalizedTiers)
        ? normalizedTiers
        : buildStatueTiersFromLevelingConstant(levelingConstant),
    };
  }

  private normalizeStageImages(value: unknown): Partial<Record<StatueLevel, string>> {
    const stageImages =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return STATUE_LEVELS.reduce<Partial<Record<StatueLevel, string>>>((accumulator, level) => {
      accumulator[level] = this.readText(stageImages[level]) || DEFAULT_STATUE_STAGE_IMAGES[level];
      return accumulator;
    }, {});
  }

  private normalizeTierMap(value: unknown): Record<StatueLevel, number> {
    const tiers =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return STATUE_LEVELS.reduce<Record<StatueLevel, number>>(
      (accumulator, level) => {
        accumulator[level] = this.readNumber(tiers[level]);
        return accumulator;
      },
      {
        rough: 0,
        outlined: 0,
        detailed: 0,
        polished: 0,
        gilded: 0,
        divine: 0,
      }
    );
  }

  private hasPositiveTierValue(tiers: Record<StatueLevel, number>): boolean {
    return STATUE_LEVELS.some((level) => tiers[level] > 0);
  }

  private normalizeLevelingConstant(
    value: unknown,
    tiers: Record<StatueLevel, number>
  ): number {
    const parsed = this.readPositiveNumber(value);
    if (parsed > 0) {
      return parsed;
    }

    for (const level of STATUE_LEVELS) {
      const tierValue = tiers[level];
      if (tierValue > 0) {
        return (STATUE_LEVELS.indexOf(level) + 1) / Math.sqrt(tierValue);
      }
    }

    return 0;
  }

  private normalizeCategory(value: unknown): StatueCategory {
    const candidate = this.readText(value) as StatueCategory;
    const categories: StatueCategory[] = [
      'strength',
      'endurance',
      'consistency',
      'progress',
      'social',
      'milestone',
    ];
    return categories.includes(candidate) ? candidate : 'strength';
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private readPositiveNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private cloneGreekStatues(statues: GreekStatueDefinition[]): GreekStatueDefinition[] {
    return statues.map((statue) => ({
      ...statue,
      stageImages: statue.stageImages ? { ...statue.stageImages } : undefined,
      tiers: { ...statue.tiers },
    }));
  }
}
