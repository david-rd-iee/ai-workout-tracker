export type StatueLevel = 'rough' | 'outlined' | 'detailed' | 'polished' | 'gilded' | 'divine';
export type StoredStatueLevel = StatueLevel | 'None';
export type StatueCategory =
  | 'strength'
  | 'endurance'
  | 'consistency'
  | 'progress'
  | 'social'
  | 'milestone';

export interface StatueTier {
  level: StatueLevel;
  threshold: number;
  color: string;
  gradientStart: string;
  gradientEnd: string;
  displayName: string;
  carvingProgress: number;
}

export interface GreekStatueDefinition {
  id: string;
  godName: string;
  title: string;
  icon: string;
  customIcon?: string;
  stageImages?: Partial<Record<StatueLevel, string>>;
  description: string;
  category: StatueCategory;
  metric: string;
  unit?: string;
  mythology: string;
  levelingConstant: number;
  tiers: Record<StatueLevel, number>;
}

export interface GreekStatue extends GreekStatueDefinition {
  currentValue?: number;
  metricValue?: number;
  currentLevel?: StoredStatueLevel;
  percentile?: number;
  nextTierValue?: number;
  progressToNext?: number;
}

export const STATUE_LEVELS: StatueLevel[] = [
  'rough',
  'outlined',
  'detailed',
  'polished',
  'gilded',
  'divine',
];

export const DEFAULT_STATUE_STAGE_IMAGES: Record<StatueLevel, string> = {
  rough: 'assets/statues/athena/athena-rough.png',
  outlined: 'assets/statues/athena/athena-outlined.png',
  detailed: 'assets/statues/athena/athena-detailed.png',
  polished: 'assets/statues/athena/athena-polished.png',
  gilded: 'assets/statues/athena/athena-gilded.png',
  divine: 'assets/statues/athena/athena-divine.png',
};

export const STATUE_TIER_CONFIG: Record<StatueLevel, StatueTier> = {
  rough: {
    level: 'rough',
    threshold: 1,
    color: '#5C4F42',
    gradientStart: '#6B5A47',
    gradientEnd: '#3E3530',
    displayName: 'Rough Stone',
    carvingProgress: 10,
  },
  outlined: {
    level: 'outlined',
    threshold: 2,
    color: '#8B7355',
    gradientStart: '#A0826D',
    gradientEnd: '#6B5A47',
    displayName: 'Outlined',
    carvingProgress: 30,
  },
  detailed: {
    level: 'detailed',
    threshold: 3,
    color: '#B8A898',
    gradientStart: '#C9BCAC',
    gradientEnd: '#9A8A7A',
    displayName: 'Detailed',
    carvingProgress: 50,
  },
  polished: {
    level: 'polished',
    threshold: 4,
    color: '#F5E6D3',
    gradientStart: '#FFFEF9',
    gradientEnd: '#E5D6C1',
    displayName: 'Polished Marble',
    carvingProgress: 70,
  },
  gilded: {
    level: 'gilded',
    threshold: 5,
    color: '#D4AF37',
    gradientStart: '#FFD700',
    gradientEnd: '#B8941A',
    displayName: 'Gold Adorned',
    carvingProgress: 90,
  },
  divine: {
    level: 'divine',
    threshold: 6,
    color: '#FFE9A0',
    gradientStart: '#FFFEF9',
    gradientEnd: '#FFD700',
    displayName: 'Divine Masterpiece',
    carvingProgress: 100,
  },
};

export function normalizeStatueLevel(value: unknown): StoredStatueLevel | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed === 'None') {
    return 'None';
  }

  return STATUE_LEVELS.includes(trimmed as StatueLevel)
    ? (trimmed as StatueLevel)
    : undefined;
}

export function isCarvedStatueLevel(
  value: StoredStatueLevel | StatueLevel | null | undefined
): value is StatueLevel {
  return value !== undefined && value !== null && value !== 'None';
}

export function getStatueLevelNumber(
  value: StoredStatueLevel | StatueLevel | null | undefined
): number {
  if (!isCarvedStatueLevel(value)) {
    return 0;
  }

  return STATUE_LEVELS.indexOf(value) + 1;
}

export function buildStatueTiersFromLevelingConstant(
  levelingConstant: number
): Record<StatueLevel, number> {
  const safeConstant = Number.isFinite(levelingConstant) && levelingConstant > 0
    ? levelingConstant
    : 0;

  return STATUE_LEVELS.reduce<Record<StatueLevel, number>>(
    (accumulator, level) => {
      accumulator[level] = safeConstant
        ? Math.round(Math.pow(getStatueLevelNumber(level) / safeConstant, 2))
        : 0;
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

export function calculateStatueOutput(
  statue: Pick<GreekStatueDefinition, 'levelingConstant'>,
  currentValue: number
): number {
  const safeConstant =
    Number.isFinite(statue.levelingConstant) && statue.levelingConstant > 0
      ? statue.levelingConstant
      : 0;
  const safeValue = Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 0;
  return safeConstant * Math.sqrt(safeValue);
}

export function calculateStoredStatueLevel(
  statue: Pick<GreekStatueDefinition, 'levelingConstant'>,
  currentValue: number
): StoredStatueLevel {
  const output = calculateStatueOutput(statue, currentValue);
  const wholeNumber = Math.floor(output);

  if (wholeNumber <= 0) {
    return 'None';
  }

  if (wholeNumber >= STATUE_LEVELS.length) {
    return 'divine';
  }

  return STATUE_LEVELS[wholeNumber - 1];
}

export function calculateStatueLevel(
  statue: Pick<GreekStatueDefinition, 'levelingConstant'>,
  currentValue: number
): StatueLevel | null {
  const storedLevel = calculateStoredStatueLevel(statue, currentValue);
  return isCarvedStatueLevel(storedLevel) ? storedLevel : null;
}

export function getNextStatueLevel(
  currentLevel: StoredStatueLevel | StatueLevel | null | undefined
): StatueLevel | null {
  if (!isCarvedStatueLevel(currentLevel)) {
    return 'rough';
  }

  const nextIndex = STATUE_LEVELS.indexOf(currentLevel) + 1;
  return nextIndex < STATUE_LEVELS.length ? STATUE_LEVELS[nextIndex] : null;
}

export function calculateCarvingProgress(
  statue: Pick<GreekStatue, 'levelingConstant' | 'tiers'>,
  currentValue: number
): {
  currentLevel: StatueLevel | null;
  nextLevel: StatueLevel | null;
  nextTierValue: number | null;
  progressPercentage: number;
  carvingPercentage: number;
} {
  const output = calculateStatueOutput(statue, currentValue);
  const wholeNumber = Math.floor(output);
  const fractionalProgress = output - wholeNumber;
  const currentLevel = calculateStatueLevel(statue, currentValue);
  const nextLevel = getNextStatueLevel(currentLevel);

  if (!currentLevel) {
    return {
      currentLevel: null,
      nextLevel,
      nextTierValue: nextLevel ? statue.tiers[nextLevel] ?? null : null,
      progressPercentage: Math.max(0, Math.min(100, Math.round(fractionalProgress * 100))),
      carvingPercentage: 0,
    };
  }

  return {
    currentLevel,
    nextLevel,
    nextTierValue: nextLevel ? statue.tiers[nextLevel] ?? null : null,
    progressPercentage: nextLevel
      ? Math.max(0, Math.min(100, Math.round(fractionalProgress * 100)))
      : 100,
    carvingPercentage: STATUE_TIER_CONFIG[currentLevel].carvingProgress,
  };
}

export function getCarvingStageDescription(level: StatueLevel | null): string {
  if (!level) {
    return 'This block of marble has not yet been carved.';
  }

  const descriptions: Record<StatueLevel, string> = {
    rough: 'The first shape emerges from raw stone.',
    outlined: 'The outline is visible and the god takes form.',
    detailed: 'Fine details are being carved into the marble.',
    polished: 'The statue has been refined into smooth marble.',
    gilded: 'Gold adornments now mark this statue as exceptional.',
    divine: 'A complete divine masterpiece stands before the gods.',
  };

  return descriptions[level];
}
