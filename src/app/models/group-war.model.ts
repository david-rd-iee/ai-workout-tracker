import { Timestamp } from '@angular/fire/firestore';

export type GroupWarStatus =
  | 'pending_confirmation'
  | 'pending_acceptance'
  | 'active'
  | 'finalizing'
  | 'finalized'
  | 'declined'
  | 'cancelled'
  | 'expired';

export type GroupWarResult = 'challenger_win' | 'opponent_win' | 'tie';

export interface GroupWar {
  warId: string;
  groupAId?: string;
  groupBId?: string;
  challengerGroupId: string;
  opponentGroupId: string;
  challengerOwnerUid: string;
  opponentOwnerUid: string;
  groupAAccepted: boolean;
  groupBAccepted: boolean;
  acceptedAt?: Timestamp;
  startAt?: Timestamp;
  endAt?: Timestamp;
  challengerAcceptedAt?: Timestamp;
  opponentAcceptedAt?: Timestamp;
  status: GroupWarStatus;
  activatedAt?: Timestamp;
  endsAt?: Timestamp;
  finalizedAt?: Timestamp;
  challengerScoreTotal: number;
  opponentScoreTotal: number;
  groupAPoints?: number;
  groupBPoints?: number;
  groupACardioPoints?: number;
  groupAStrengthPoints?: number;
  groupBCardioPoints?: number;
  groupBStrengthPoints?: number;
  result?: GroupWarResult;
  leaderboardPointsAwarded: boolean;
  challengerPointsAwarded?: number;
  opponentPointsAwarded?: number;
  challengerMemberUserIdsAtStart: string[];
  opponentMemberUserIdsAtStart: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GroupWarContribution {
  warId: string;
  groupId: string;
  userId: string;
  normalizedWorkoutScoreTotal: number;
  totalContribution?: number;
  cardioContribution?: number;
  strengthContribution?: number;
  exerciseContributionDeltas?: Record<string, number>;
  topExerciseTag?: string;
  scoreSource?: string;
  workoutCount: number;
  lastContributionAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface GroupWarMemberStanding {
  warId: string;
  groupId: string;
  userId: string;
  displayName: string;
  profilePicUrl?: string;
  normalizedWorkoutScoreTotal: number;
  totalContribution?: number;
  cardioContributionTotal?: number;
  strengthContributionTotal?: number;
  exerciseContributionTotals?: Record<string, number>;
  topExerciseTag?: string;
  lastContributionAt?: Timestamp;
  workoutCount: number;
  rank: number;
}

export interface GroupLeaderboardEntry {
  groupId: string;
  groupName: string;
  groupImage?: string;
  rank: number;
  globalLeaderboardRank?: number;
  totalWarLeaderboardPoints: number;
  warRating: number;
  warWeight: number;
  wins: number;
  losses: number;
  ties: number;
  dominantExerciseTag?: string;
  currentActiveWarId?: string;
  lastWarEndedAt?: Timestamp;
}

export interface GroupWarRecapWinnerSummary {
  type: 'group' | 'tie';
  groupId?: string;
  groupName?: string;
}

export interface GroupWarRecapFinalScore {
  challenger: number;
  opponent: number;
  margin: number;
}

export interface GroupWarRecapContributorSummary {
  userId: string;
  groupId: string;
  displayName: string;
  profilePicUrl?: string;
  normalizedWorkoutScoreTotal: number;
  workoutCount: number;
  topExerciseTag?: string;
}

export interface GroupWarRecapExerciseSummary {
  exerciseTag: string;
  normalizedWorkoutScoreTotal: number;
}

export interface GroupWarRecapWorkoutTotals {
  total: number;
  challenger: number;
  opponent: number;
}

export interface GroupWarRecapCategoryShare {
  cardioPoints: number;
  strengthPoints: number;
  cardioShare: number;
  strengthShare: number;
}

export interface GroupWarRecapStandoutContribution {
  contributionId: string;
  workoutEventId: string;
  userId: string;
  groupId: string;
  displayName: string;
  profilePicUrl?: string;
  normalizedWorkoutScoreTotal: number;
  cardioContribution: number;
  strengthContribution: number;
  topExerciseTag?: string;
  contributedAt?: Timestamp;
}

export interface GroupWarRecap {
  warId: string;
  status: GroupWarStatus;
  result?: GroupWarResult;
  challengerGroupId: string;
  challengerGroupName: string;
  opponentGroupId: string;
  opponentGroupName: string;
  activatedAt?: Timestamp;
  endsAt?: Timestamp;
  finalizedAt?: Timestamp;
  challengerScoreTotal: number;
  opponentScoreTotal: number;
  challengerPointsAwarded: number;
  opponentPointsAwarded: number;
  winnerGroupId?: string;
  challengerTopMembers: GroupWarMemberStanding[];
  opponentTopMembers: GroupWarMemberStanding[];
  winner?: GroupWarRecapWinnerSummary;
  finalScore?: GroupWarRecapFinalScore;
  topContributorByTeam?: {
    challenger: GroupWarRecapContributorSummary | null;
    opponent: GroupWarRecapContributorSummary | null;
  };
  mostUsedExerciseByTeam?: {
    challenger: GroupWarRecapExerciseSummary | null;
    opponent: GroupWarRecapExerciseSummary | null;
  };
  totalWorkoutsSubmitted?: GroupWarRecapWorkoutTotals;
  cardioVsStrengthShare?: {
    challenger: GroupWarRecapCategoryShare;
    opponent: GroupWarRecapCategoryShare;
    overall: GroupWarRecapCategoryShare;
  };
  standoutSingleWorkoutContribution?: GroupWarRecapStandoutContribution | null;
}
