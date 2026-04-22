# Group Wars Design (Rules)

## Overview

Group Wars is a head-to-head competition between two groups.

This document defines the rules and projection behavior so Group Wars fits the existing architecture:

- Canonical workout storage remains authoritative.
- War standings and leaderboard outcomes are derived projections.
- Global group leaderboard points are awarded only when a war finalizes.

## Product Rules

1. A group can have at most one active war at any time.
2. War duration is exactly 7 days.
3. Both group owners must explicitly accept before the war activates.
4. War score is the sum of normalized workout scores during the war window.
5. Global group leaderboard points are awarded only once, at war finalization.

## Architecture Fit

Group Wars should follow the same pattern as workout scoring:

- Canonical source: user workout events (`users/{uid}/workoutEvents/{eventId}`).
- Derived projections: war score totals, war outcomes, global group leaderboard points.
- No Group Wars logic should mutate canonical workout events.

## Core Domain Model

### War

Represents one challenge between two groups.

Suggested fields:

- `warId`
- `challengerGroupId`
- `opponentGroupId`
- `challengerOwnerUid`
- `opponentOwnerUid`
- `challengerAcceptedAt` (nullable)
- `opponentAcceptedAt` (nullable)
- `status`: `pending_acceptance | active | finalizing | finalized | declined | cancelled | expired`
- `activatedAt` (nullable)
- `endsAt` (nullable, `activatedAt + 7 days`)
- `finalizedAt` (nullable)
- `score`:
  - `challengerTotal`
  - `opponentTotal`
- `result`: `challenger_win | opponent_win | tie` (nullable)
- `leaderboardPointsAwarded`: boolean
- `createdAt`
- `updatedAt`

### Group War Lock (One Active War Constraint)

To enforce one active war per group, use a lock-like invariant for each group:

- Group has no active war when `activeWarId` is null/absent.
- Group has one active war when `activeWarId = <warId>`.

This can be stored either:

- on group docs (`groupID/{groupId}.activeWarId`), or
- in a dedicated lock collection.

The key requirement is transactional enforcement across both groups at activation.

## Firestore Collections

The Group Wars feature uses the following Firestore paths:

- `groupWars/{warId}`
  - Master record for each war.
- `groupWars/{warId}/contributions/{contributionId}`
  - One doc per workout contribution counted toward the war.
- `groupWars/{warId}/members/{userId}`
  - Aggregated per-member standings for the war.
- `groupLeaderboards/global/rankings/{groupId}`
  - Persistent global group leaderboard entry per group.
- `groupWars/{warId}/recap/summary`
  - Post-war recap ("wrapped") summary doc.

## Lifecycle Rules

### 1. Challenge Created

- War starts in `pending_acceptance`.
- No score accumulation.
- No leaderboard point effects.

### 2. Owner Acceptance

- Both owners must accept.
- When second acceptance is recorded:
  - system validates both groups still have no other active war,
  - system atomically sets the war to `active`,
  - sets `activatedAt = now`,
  - sets `endsAt = activatedAt + 7 days`,
  - acquires active-war lock for both groups.

### 3. Active War Window

- Only workouts in `[activatedAt, endsAt)` are eligible.
- War score is:

  `group_war_score = SUM(normalized_workout_score for eligible workouts by eligible members)`

- "Eligible members" should be snapshotted at activation time to prevent roster manipulation during the war.
- During active state, global leaderboard points are not awarded.

### 4. Finalization

- War enters `finalizing` after `endsAt` is reached.
- Finalization computes/validates final totals, determines winner/tie, awards global points once, then marks `finalized`.
- Finalization releases both groups' active-war locks.

## Scoring Rules

### Normalized Workout Score

Use the existing normalized workout scoring output from the workout projection pipeline. Group Wars consumes that derived metric rather than redefining scoring.

### War Totals

- Challenger total = sum of normalized workout scores for challenger group in war window.
- Opponent total = sum of normalized workout scores for opponent group in war window.

Tie behavior:

- If totals equal, result is `tie`.

### Membership Snapshot

Freeze participant membership at activation:

- `challengerMemberUserIdsAtStart[]`
- `opponentMemberUserIdsAtStart[]`

This avoids join/leave exploits mid-war and keeps finalization deterministic.

## Global Group Leaderboard Points

Global points are projection-only and awarded only on finalization.
War score totals remain war-local and are never reused as global leaderboard totals.

Suggested configurable outcomes:

- winner points = `W`
- loser points = `L`
- tie points = `T` for both groups

Rules:

1. No global leaderboard increments on individual workouts.
2. Exactly one global leaderboard award transaction per war.
3. Award operation must be idempotent (`leaderboardPointsAwarded == false` guard + transaction).
4. Persist long-term points on each group (`groupID/{groupId}.totalWarLeaderboardPoints`).
5. Persist a ranking number on each group (`groupID/{groupId}.globalLeaderboardRank`).
6. Optionally mirror that projection to `groupLeaderboards/global/rankings/{groupId}` for fast list queries.

## Processing and Consistency

### Event Handling

- Workout ingestion remains unchanged.
- War score projections may update during active wars for UX/live progress.
- Global leaderboard projection must not update until war finalization.

### Finalization Worker

Run on schedule and/or trigger when a war crosses `endsAt`:

1. Find `active` wars with `endsAt <= now`.
2. Transition to `finalizing` (idempotent guard).
3. Compute deterministic final totals from canonical/derived score records within window.
4. Write result.
5. Award global leaderboard points in same transactional boundary when possible.
6. Mark `leaderboardPointsAwarded = true`.
7. Mark `finalized` and release group locks.

### Idempotency Requirements

- Re-running finalization must not double-award points.
- Reprocessing delayed workout projections after finalization should not alter awarded points.
- Store explicit per-war award marker and optional immutable award record (`groupWarAwards/{warId}`).

## Enforcement Invariants

1. A group cannot activate a second war while `activeWarId` is set.
2. A war cannot become `active` unless both owners accepted.
3. `endsAt` must equal `activatedAt + 7 days`.
4. Leaderboard points can only be awarded when status transitions through finalization.
5. A finalized war cannot return to active states.

## Edge Cases

- Owner declines before activation: mark `declined`; no locks or points.
- Acceptance timeout: optional `expired` state if not fully accepted by configured TTL.
- Group deleted mid-war: finalize with existing snapshot and available score data, then close.
- Late-arriving workout score projection after `endsAt`: include only if workout timestamp is within window and finalization policy allows grace period; otherwise ignore.

## Observability

Emit structured logs/metrics for:

- war activation success/failure (including lock conflicts),
- finalization duration and failure count,
- point award success/idempotent skips,
- war result distribution (wins/losses/ties).

## Summary

This ruleset keeps Group Wars aligned with the current architecture:

- canonical workout facts stay separate,
- war standings are derived,
- global leaderboard points are updated once per finalized war, not per workout.
