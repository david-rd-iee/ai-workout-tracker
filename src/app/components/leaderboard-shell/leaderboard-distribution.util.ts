import type { LeaderboardEntry } from '../../services/leaderboard.service';
import type { DistributionPoint } from './leaderboard-shell.component';

const CHART_LEFT_PERCENT = 0;
const CHART_RIGHT_PERCENT = 100;
const CHART_BOTTOM_PERCENT = 92;
const CURVE_HEIGHT_PERCENT = 70;
const CURVE_SAMPLE_COUNT = 96;
const LOWER_VISIBLE_PERCENTILE = 0.01;
const UPPER_VISIBLE_PERCENTILE = 0.99;
const MAX_GROUP_SCORE_SPAN = 15;
const MIN_POINT_GAP_PERCENT = 5;
const POINT_EDGE_PADDING_PERCENT = 2;
const MEAN_CENTER_THRESHOLD = 10;
const SMALL_SAMPLE_EDGE_PADDING_RATIO = 0.16;
const SMALL_SAMPLE_CURVE_HEIGHT_PERCENT = 54;
const SMALL_SAMPLE_DENSITY_POWER = 0.5;

export type LeaderboardDistributionChart = {
  curvePath: string;
  points: DistributionPoint[];
  medianXPercent: number | null;
  medianLabel: string;
};

type ScoredEntry = {
  entry: LeaderboardEntry;
  score: number;
  clampedScore: number;
};

type PointGroup = {
  entries: ScoredEntry[];
  minScore: number;
  maxScore: number;
  anchorScore: number;
};

type DensityPoint = {
  score: number;
  weight: number;
};

export function buildLeaderboardDistributionChart(
  entries: LeaderboardEntry[],
  scoreFor: (entry: LeaderboardEntry) => number
): LeaderboardDistributionChart {
  if (entries.length === 0) {
    return emptyLeaderboardDistributionChart();
  }

  const scoredEntries = entries
    .map((entry) => ({
      entry,
      score: Number(scoreFor(entry)),
    }))
    .filter(
      (candidate): candidate is { entry: LeaderboardEntry; score: number } =>
        Number.isFinite(candidate.score)
    );

  if (scoredEntries.length === 0) {
    return emptyLeaderboardDistributionChart();
  }

  const scores = scoredEntries.map((candidate) => candidate.score).sort((a, b) => a - b);
  const isSmallSample = scoredEntries.length <= MEAN_CENTER_THRESHOLD;
  const lowerVisibleScore = isSmallSample ? scores[0] : quantile(scores, LOWER_VISIBLE_PERCENTILE);
  const median = quantile(scores, 0.5);
  const upperVisibleScore = isSmallSample
    ? scores[scores.length - 1]
    : quantile(scores, UPPER_VISIBLE_PERCENTILE);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const centerScore = isSmallSample ? mean : median;
  const smallSamplePadding = isSmallSample
    ? Math.max(
        (upperVisibleScore - lowerVisibleScore) * SMALL_SAMPLE_EDGE_PADDING_RATIO,
        1
      )
    : 0;

  const radius = Math.max(
    Math.abs(centerScore - lowerVisibleScore),
    Math.abs(upperVisibleScore - centerScore),
    Math.max(Math.abs(centerScore) * 0.05, 1)
  );

  let minScore = centerScore - (radius + smallSamplePadding);
  let maxScore = centerScore + (radius + smallSamplePadding);

  if (!Number.isFinite(minScore) || !Number.isFinite(maxScore)) {
    return emptyLeaderboardDistributionChart();
  }

  if (maxScore - minScore < 1e-6) {
    const fallbackRadius = Math.max(Math.abs(centerScore) * 0.05, 1);
    minScore = centerScore - fallbackRadius;
    maxScore = centerScore + fallbackRadius;
  }

  const scoreSpan = Math.max(maxScore - minScore, 1e-6);
  const clampedEntries: ScoredEntry[] = scoredEntries.map((candidate) => ({
    ...candidate,
    clampedScore: clamp(candidate.score, minScore, maxScore),
  }));
  const pointGroups = buildPointGroups(clampedEntries);
  const densityPoints = buildDensityPoints(clampedEntries, pointGroups);
  const bandwidth = calculateBandwidth(clampedEntries, pointGroups, scoreSpan);
  const toXPct = (score: number): number =>
    CHART_LEFT_PERCENT +
    ((clamp(score, minScore, maxScore) - minScore) / scoreSpan) *
      (CHART_RIGHT_PERCENT - CHART_LEFT_PERCENT);
  const densityAt = (score: number): number =>
    densityPoints.reduce((sum, point) => {
      const z = (score - point.score) / bandwidth;
      return sum + point.weight * Math.exp(-0.5 * z * z);
    }, 0);

  const densitySamples = Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
    const score = minScore + (scoreSpan * index) / CURVE_SAMPLE_COUNT;
    return {
      score,
      density: densityAt(score),
    };
  });

  const maxDensity = Math.max(...densitySamples.map((sample) => sample.density), 1);
  const curveHeightPercent = isSmallSample ? SMALL_SAMPLE_CURVE_HEIGHT_PERCENT : CURVE_HEIGHT_PERCENT;
  const toYPct = (density: number): number => {
    const normalizedDensity = clamp(density / maxDensity, 0, 1);
    const shapedDensity = isSmallSample
      ? Math.pow(normalizedDensity, SMALL_SAMPLE_DENSITY_POWER)
      : normalizedDensity;
    return CHART_BOTTOM_PERCENT - shapedDensity * curveHeightPercent;
  };

  const samples: string[] = [
    `M ${CHART_LEFT_PERCENT.toFixed(2)} ${CHART_BOTTOM_PERCENT.toFixed(2)}`,
  ];
  for (const sample of densitySamples) {
    samples.push(`L ${toXPct(sample.score).toFixed(2)} ${toYPct(sample.density).toFixed(2)}`);
  }
  samples.push(`L ${CHART_RIGHT_PERCENT.toFixed(2)} ${CHART_BOTTOM_PERCENT.toFixed(2)}`);

  const rawPointXPercents = pointGroups.map((group) => toXPct(group.anchorScore));
  const pointXPercents = spreadPointXPercents(
    rawPointXPercents,
    CHART_LEFT_PERCENT + POINT_EDGE_PADDING_PERCENT,
    CHART_RIGHT_PERCENT - POINT_EDGE_PADDING_PERCENT
  );
  const points = pointGroups.map((group, pointIndex) => ({
    binIndex: pointIndex,
    xPercent: pointXPercents[pointIndex],
    yPercent: toYPct(densityAt(group.anchorScore)),
    count: group.entries.length,
    userIds: group.entries.map((candidate) => candidate.entry.userId),
    rangeLabel: buildRangeLabel(group.minScore, group.maxScore),
  }));

  return {
    curvePath: samples.join(' '),
    points,
    medianXPercent: toXPct(centerScore),
    medianLabel: String(Math.round(centerScore)),
  };
}

export function emptyLeaderboardDistributionChart(): LeaderboardDistributionChart {
  return {
    curvePath: '',
    points: [],
    medianXPercent: null,
    medianLabel: '',
  };
}

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateBandwidth(
  entries: Array<{ clampedScore: number }>,
  pointGroups: PointGroup[],
  scoreSpan: number
): number {
  if (entries.length <= 1) {
    return Math.max(scoreSpan / 6, 1e-3);
  }

  if (entries.length <= MEAN_CENTER_THRESHOLD) {
    return calculateSmallSampleBandwidth(pointGroups, scoreSpan);
  }

  const mean =
    entries.reduce((sum, candidate) => sum + candidate.clampedScore, 0) / entries.length;
  const variance =
    entries.reduce((sum, candidate) => sum + (candidate.clampedScore - mean) ** 2, 0) /
    entries.length;
  const stdDev = Math.sqrt(variance);
  const silverman = 1.06 * stdDev * Math.pow(entries.length, -0.2);
  const spacingDriven = scoreSpan / Math.max(Math.sqrt(entries.length) * 2, 4);
  return Math.max(silverman, spacingDriven, scoreSpan / CURVE_SAMPLE_COUNT, 1e-3);
}

function calculateSmallSampleBandwidth(pointGroups: PointGroup[], scoreSpan: number): number {
  const widestGroupSpan = Math.max(...pointGroups.map((group) => group.maxScore - group.minScore), 0);
  const baseBandwidth = Math.max(widestGroupSpan * 1.5, scoreSpan / 40, 3);
  const groupGaps = pointGroups
    .slice(1)
    .map((group, index) => group.anchorScore - pointGroups[index].anchorScore)
    .filter((gap) => gap > 0);

  if (groupGaps.length === 0) {
    return Math.max(baseBandwidth, scoreSpan / CURVE_SAMPLE_COUNT, 1e-3);
  }

  const nearestGap = Math.min(...groupGaps);
  return Math.max(
    Math.min(baseBandwidth, nearestGap * 0.32),
    scoreSpan / CURVE_SAMPLE_COUNT,
    1e-3
  );
}

function buildDensityPoints(entries: ScoredEntry[], pointGroups: PointGroup[]): DensityPoint[] {
  if (entries.length <= MEAN_CENTER_THRESHOLD) {
    return pointGroups.map((group) => ({
      score: group.anchorScore,
      weight: group.entries.length,
    }));
  }

  return entries.map((entry) => ({
    score: entry.clampedScore,
    weight: 1,
  }));
}

function buildPointGroups(entries: ScoredEntry[]): PointGroup[] {
  if (entries.length === 0) {
    return [];
  }

  const sortedEntries = [...entries].sort((a, b) => a.score - b.score);
  const groups: PointGroup[] = [];
  let currentEntries: ScoredEntry[] = [];
  let currentGroupStartScore = 0;

  for (const candidate of sortedEntries) {
    if (currentEntries.length === 0) {
      currentEntries = [candidate];
      currentGroupStartScore = candidate.score;
      continue;
    }

    if (candidate.score - currentGroupStartScore <= MAX_GROUP_SCORE_SPAN) {
      currentEntries.push(candidate);
      continue;
    }

    groups.push(finalizePointGroup(currentEntries));
    currentEntries = [candidate];
    currentGroupStartScore = candidate.score;
  }

  if (currentEntries.length > 0) {
    groups.push(finalizePointGroup(currentEntries));
  }

  return groups;
}

function finalizePointGroup(entries: ScoredEntry[]): PointGroup {
  const minScore = Math.min(...entries.map((candidate) => candidate.score));
  const maxScore = Math.max(...entries.map((candidate) => candidate.score));
  const anchorScore =
    entries.reduce((sum, candidate) => sum + candidate.clampedScore, 0) / entries.length;

  return {
    entries,
    minScore,
    maxScore,
    anchorScore,
  };
}

function spreadPointXPercents(
  rawXPercents: number[],
  minXPercent: number,
  maxXPercent: number
): number[] {
  if (rawXPercents.length === 0) {
    return [];
  }

  if (rawXPercents.length === 1) {
    return [clamp(rawXPercents[0], minXPercent, maxXPercent)];
  }

  const availableSpan = Math.max(maxXPercent - minXPercent, 0);
  const minGap = Math.min(
    MIN_POINT_GAP_PERCENT,
    availableSpan / Math.max(rawXPercents.length - 1, 1)
  );
  const laidOut = rawXPercents.map((xPercent) => clamp(xPercent, minXPercent, maxXPercent));

  for (let index = 1; index < laidOut.length; index += 1) {
    laidOut[index] = Math.max(laidOut[index], laidOut[index - 1] + minGap);
  }

  laidOut[laidOut.length - 1] = Math.min(laidOut[laidOut.length - 1], maxXPercent);

  for (let index = laidOut.length - 2; index >= 0; index -= 1) {
    laidOut[index] = Math.min(laidOut[index], laidOut[index + 1] - minGap);
  }

  laidOut[0] = Math.max(laidOut[0], minXPercent);

  for (let index = 1; index < laidOut.length; index += 1) {
    laidOut[index] = Math.max(laidOut[index], laidOut[index - 1] + minGap);
  }

  return laidOut.map((xPercent) => clamp(xPercent, minXPercent, maxXPercent));
}

function buildRangeLabel(rangeStart: number, rangeEnd: number): string {
  const roundedStart = Math.round(rangeStart);
  const roundedEnd = Math.round(rangeEnd);

  if (roundedStart === roundedEnd) {
    return String(roundedStart);
  }

  return `${roundedStart}-${roundedEnd}`;
}
