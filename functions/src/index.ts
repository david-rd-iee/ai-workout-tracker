import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import OpenAI from "openai";
import {
  createEmptyWorkoutEvent,
  normalizeWorkoutEventCandidate,
  workoutEventToLegacyWorkoutSession,
} from "../../shared/adapters/workout-event.adapters";
import type {
  CardioWorkoutEventEntry,
  StrengthWorkoutEventEntry,
  WorkoutEvent,
  WorkoutEventEntry,
  WorkoutEventSource,
} from "../../shared/models/workout-event.model";
export { retrainExerciseEstimatorOnWorkoutLogCreate } from "./exerciseEstimatorTraining";
export { completeWorkoutEvent } from "./completeWorkoutEvent";
export { onClientTrainerAssignmentChange } from "./userStatsVerification";
export { proposeGroupWarMatches } from "./groupWarMatchmaking";
export { onGroupWarProposalUpdated } from "./groupWarProposalLifecycle";
export { finalizeExpiredGroupWars } from "./groupWarFinalization";
export {
  ensureGroupChatForGroup,
  onGroupDocumentWrittenSyncChat,
} from "./groupChatSync";
export {
  onWorkoutEventCreated,
} from "./workoutEventPostWriteHandlers";
export { createTrainerOnboardingLink } from "./trainerStripeOnboarding";
export { createTrainerPlan } from "./trainerPlans";
export { createCheckoutSession } from "./clientCheckout";
export { createAgreementCheckoutSession } from "./agreementCheckout";
export { stripeWebhook } from "./stripeWebhook";
export { acceptTrainerClientRequest } from "./trainerClientRequests";
export { requestSessionBooking } from "./sessionBookingRequests";
export {
  enforceTrainerProfileMirror,
  syncTrainerProfileFromUsers,
} from "./trainerProfileSync";

if (getApps().length === 0) {
  initializeApp();
}

const openaiApiKey = defineSecret("OPENAI_API_KEY");

function normalizeStringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeNotificationData(data: Record<string, unknown> | undefined): Record<string, string> {
  if (!data || typeof data !== "object") {
    return {};
  }

  return Object.entries(data).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (value === null || value === undefined) {
      return accumulator;
    }

    if (typeof value === "string") {
      accumulator[key] = value;
      return accumulator;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      accumulator[key] = String(value);
      return accumulator;
    }

    accumulator[key] = JSON.stringify(value);
    return accumulator;
  }, {});
}

async function loadPushTokensForUser(userId: string): Promise<string[]> {
  const firestore = getFirestore();
  const [userSnap, trainerSnap, clientSnap] = await Promise.all([
    firestore.doc(`users/${userId}`).get(),
    firestore.doc(`trainers/${userId}`).get(),
    firestore.doc(`clients/${userId}`).get(),
  ]);

  const rawTokenValues = [
    userSnap.get("apnsPushTokens"),
    userSnap.get("pushTokens"),
    userSnap.get("fcmTokens"),
    trainerSnap.get("apnsPushTokens"),
    trainerSnap.get("pushTokens"),
    trainerSnap.get("fcmTokens"),
    clientSnap.get("apnsPushTokens"),
    clientSnap.get("pushTokens"),
    clientSnap.get("fcmTokens"),
  ];

  const uniqueTokens = new Set<string>();
  for (const rawValue of rawTokenValues) {
    if (!Array.isArray(rawValue)) {
      continue;
    }

    for (const tokenEntry of rawValue) {
      const normalizedToken = normalizeStringValue(tokenEntry);
      if (normalizedToken) {
        uniqueTokens.add(normalizedToken);
      }
    }
  }

  return Array.from(uniqueTokens);
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractDistanceMeters(value: unknown): number | undefined {
  const direct = toPositiveNumber(value);
  if (typeof direct === "number") {
    return direct;
  }

  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return undefined;
  }

  const match = text.match(/([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/);
  if (!match) {
    return undefined;
  }

  const magnitude = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return undefined;
  }

  if (unit === "mi" || unit === "mile" || unit === "miles") {
    return Math.round(magnitude * 1609.344);
  }
  if (unit === "km" || unit === "kilometer" || unit === "kilometers") {
    return Math.round(magnitude * 1000);
  }
  return Math.round(magnitude);
}

function extractTimeMinutes(value: unknown): number | undefined {
  const direct = toPositiveNumber(value);
  if (typeof direct === "number") {
    return direct;
  }

  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return undefined;
  }

  const match = text.match(/([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/);
  if (!match) {
    return undefined;
  }

  const magnitude = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return undefined;
  }

  if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
    return Math.round(magnitude * 60);
  }
  return Math.round(magnitude);
}

function extractWeightKg(value: unknown): number | undefined {
  const direct = toPositiveNumber(value);
  if (typeof direct === "number") {
    return direct;
  }

  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text.includes("body")) {
    return undefined;
  }

  const match = text.match(
    /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)?\b/
  );
  if (!match) {
    return undefined;
  }

  const magnitude = Number(match[1]);
  const unit = String(match[2] ?? "kg").toLowerCase();
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return undefined;
  }

  if (unit === "lb" || unit === "lbs" || unit === "pound" || unit === "pounds") {
    return Math.round(magnitude * 0.45359237 * 100) / 100;
  }

  return Math.round(magnitude * 100) / 100;
}

function extractWeightMetricText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }

  if (/body\s*weight/i.test(text) || /bodyweight/i.test(text)) {
    return "bodyweight";
  }

  const match = text.match(
    /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)\b/i
  );
  return match?.[0]?.trim();
}

function extractDistanceAndTimeFromMessage(message: string): {distance?: number; time?: number} {
  const text = String(message ?? "").toLowerCase();
  const distanceMatch = text.match(/([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/);
  const timeMatch = text.match(/([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/);

  const distance = distanceMatch ? extractDistanceMeters(distanceMatch[0]) : undefined;
  const time = timeMatch ? extractTimeMinutes(timeMatch[0]) : undefined;
  return {distance, time};
}

function extractDistanceAndTimeTokensFromMessage(message: string): {distanceText?: string; timeText?: string} {
  const text = String(message ?? "");
  const distanceMatch = text.match(/([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/i);
  const timeMatch = text.match(/([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/i);
  return {
    distanceText: distanceMatch?.[0]?.trim(),
    timeText: timeMatch?.[0]?.trim(),
  };
}

function inferCardioTypeFromMessage(message: string): string | undefined {
  const text = String(message ?? "").toLowerCase();
  if (!text.trim()) {
    return undefined;
  }

  if (/\b(run|ran|running|jog|jogging|sprint|sprinting|treadmill)\b/.test(text)) {
    return "running";
  }
  if (/\b(bike|biked|biking|cycle|cycling|spin|spinning)\b/.test(text)) {
    return "biking";
  }
  if (/\b(swim|swam|swimming)\b/.test(text)) {
    return "swimming";
  }
  if (/\b(walk|walked|walking|hike|hiked|hiking)\b/.test(text)) {
    return "walking";
  }
  if (/\b(row|rowed|rowing)\b/.test(text)) {
    return "rowing";
  }
  if (/\b(elliptical|stair|stairs|stepper)\b/.test(text)) {
    return "cardio_machine";
  }

  return undefined;
}

interface NormalizeAssistantSummaryOptions {
  latestMessage: string;
  source: WorkoutEventSource;
  defaultDate?: string;
  cardioTypeFallback?: string;
}

function normalizeAssistantSummary(
  summary: unknown,
  options: NormalizeAssistantSummaryOptions
): unknown {
  const event = normalizeWorkoutEventCandidate(summary, {
    defaultDate: options.defaultDate,
    source: options.source,
  });

  return workoutEventToLegacyWorkoutSession(
    applyAssistantHeuristicsToEvent(event, options)
  );
}

function applyAssistantHeuristicsToEvent(
  event: WorkoutEvent,
  options: NormalizeAssistantSummaryOptions
): WorkoutEvent {
  const nextEvent: WorkoutEvent = {
    ...event,
    entries: event.entries.map((entry) => cloneWorkoutEventEntry(entry)),
    summary: {
      ...event.summary,
    },
  };
  const latestWeightText = extractWeightMetricText(options.latestMessage);
  const firstStrengthEntryIndex = nextEvent.entries.findIndex((entry) => entry.kind === "strength");

  if (latestWeightText && firstStrengthEntryIndex >= 0) {
    const strengthEntry = nextEvent.entries[firstStrengthEntryIndex] as StrengthWorkoutEventEntry;
    const currentLoadText = String(strengthEntry.load.displayText ?? "").trim().toLowerCase();
    if (!currentLoadText || currentLoadText === "bodyweight" || currentLoadText === "body weight") {
      strengthEntry.load = {
        displayText: latestWeightText,
        weightKg: extractWeightKg(latestWeightText) ?? strengthEntry.load.weightKg,
      };
    }
  }

  const inferredCardioType = normalizeCardioType(
    options.cardioTypeFallback || inferCardioTypeFromMessage(options.latestMessage)
  );
  const fromMessage = extractDistanceAndTimeFromMessage(options.latestMessage);
  const fromMessageText = extractDistanceAndTimeTokensFromMessage(options.latestMessage);
  const firstCardioEntryIndex = nextEvent.entries.findIndex((entry) => entry.kind === "cardio");

  if (
    firstCardioEntryIndex === -1 &&
    inferredCardioType &&
    (typeof fromMessage.distance === "number" || typeof fromMessage.time === "number")
  ) {
    nextEvent.entries.push({
      kind: "cardio",
      cardioType: inferredCardioType,
      estimatedCalories: 0,
      ...(fromMessageText.distanceText || typeof fromMessage.distance === "number"
        ? {
          distance: {
            ...(fromMessageText.distanceText ? {displayText: fromMessageText.distanceText} : {}),
            ...(typeof fromMessage.distance === "number" ? {meters: fromMessage.distance} : {}),
          },
        }
        : {}),
      ...(fromMessageText.timeText || typeof fromMessage.time === "number"
        ? {
          duration: {
            ...(fromMessageText.timeText ? {displayText: fromMessageText.timeText} : {}),
            ...(typeof fromMessage.time === "number" ? {minutes: fromMessage.time} : {}),
          },
        }
        : {}),
    });
  } else if (firstCardioEntryIndex >= 0) {
    const cardioEntry = nextEvent.entries[firstCardioEntryIndex] as CardioWorkoutEventEntry;
    if ((!cardioEntry.cardioType || cardioEntry.cardioType === "cardio_activity") && inferredCardioType) {
      cardioEntry.cardioType = inferredCardioType;
    }

    const nextDistance = cardioEntry.distance ? {...cardioEntry.distance} : {};
    if (!nextDistance.displayText && fromMessageText.distanceText) {
      nextDistance.displayText = fromMessageText.distanceText;
    }
    if (typeof nextDistance.meters !== "number" && typeof fromMessage.distance === "number") {
      nextDistance.meters = fromMessage.distance;
    }
    if (Object.keys(nextDistance).length > 0) {
      cardioEntry.distance = nextDistance;
    }

    const nextDuration = cardioEntry.duration ? {...cardioEntry.duration} : {};
    if (!nextDuration.displayText && fromMessageText.timeText) {
      nextDuration.displayText = fromMessageText.timeText;
    }
    if (typeof nextDuration.minutes !== "number" && typeof fromMessage.time === "number") {
      nextDuration.minutes = fromMessage.time;
    }
    if (Object.keys(nextDuration).length > 0) {
      cardioEntry.duration = nextDuration;
    }
  }

  nextEvent.entries = ensureEntryCalories(
    nextEvent.entries,
    nextEvent.summary.estimatedCalories
  );
  if (nextEvent.summary.estimatedCalories <= 0) {
    nextEvent.summary.estimatedCalories = nextEvent.entries.reduce(
      (total, entry) => total + entry.estimatedCalories,
      0
    );
  }

  return nextEvent;
}

function cloneWorkoutEventEntry(entry: WorkoutEventEntry): WorkoutEventEntry {
  if (entry.kind === "strength") {
    return {
      ...entry,
      load: {...entry.load},
    };
  }

  if (entry.kind === "cardio") {
    return {
      ...entry,
      ...(entry.distance ? {distance: {...entry.distance}} : {}),
      ...(entry.duration ? {duration: {...entry.duration}} : {}),
      ...(entry.route
        ? {
          route: {
            points: entry.route.points.map((point) => ({...point})),
            ...(entry.route.bounds ? {bounds: {...entry.route.bounds}} : {}),
          },
        }
        : {}),
    };
  }

  return {
    ...entry,
    ...(entry.details ? {details: {...entry.details}} : {}),
  };
}

function ensureEntryCalories(
  entries: WorkoutEventEntry[],
  summaryEstimatedCalories: number
): WorkoutEventEntry[] {
  if (entries.length === 0) {
    return entries;
  }

  const fallbackPerEntry = summaryEstimatedCalories > 0
    ? Math.max(1, Math.round(summaryEstimatedCalories / entries.length))
    : 0;

  return entries.map((entry) => {
    if (entry.estimatedCalories > 0) {
      return entry;
    }

    return {
      ...cloneWorkoutEventEntry(entry),
      estimatedCalories: fallbackPerEntry,
    };
  });
}

function normalizeCardioType(value: string | undefined): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || undefined;
}

function buildEmptyTreadmillSummary(): unknown {
  return workoutEventToLegacyWorkoutSession(
    createEmptyWorkoutEvent(new Date().toISOString().slice(0, 10), "treadmill_logger")
  );
}

function coerceImageDataUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  if (text.startsWith("data:image/")) {
    return text;
  }

  return "";
}

function normalizeMachineType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function handleWorkoutChatRequest(body: unknown): Promise<{botMessage: string; updatedSession: unknown}> {
  const apiKey = openaiApiKey.value()?.trim() ?? "";
  if (!apiKey) {
    logger.error("Missing OPENAI_API_KEY secret for workoutChat");
    throw new HttpsError(
      "internal",
      "Internal server error in workoutChat.",
      "OPENAI_API_KEY is not configured for this function."
    );
  }

  const openai = new OpenAI({ apiKey });
  const requestBody =
    body && typeof body === "object" ? body as Record<string, unknown> : {};

  const message = requestBody["message"];
  const session = requestBody["session"];
  const history = requestBody["history"];
  const exerciseEstimatorIds = requestBody["exerciseEstimatorIds"];

  if (!message || typeof message !== "string") {
    throw new HttpsError("invalid-argument", "Missing 'message' in request body");
  }

  // ------------------------------
  //  OpenAI Prompt
  // ------------------------------
  const prompt = `
You are a friendly AI fitness coach that logs workouts into spreadsheet-like rows.
The user will describe a workout in messy natural language.

You are given:
- previousSummary: existing structured summary (if any)
- history: recent chat turns
- message: latest user message
- exerciseEstimatorIds: list of known exercise IDs from Firestore

Your job:
1. Build/update a summary object with row-based workout logs.
2. Keep conversation in two phases:
   - Phase 1: collect workout rows
   - Phase 2: collect trainer notes
3. Ask concise follow-up questions if sets/reps/weights are missing.

Required summary shape:
{
  "strengthTrainingRow": [
    {
      "Training_Type": "Strength",
      "estimated_calories": number,
      "exercise_type": string,
      "sets": number,
      "reps": number,
      "displayed_weights_metric": string,
      "weights_kg": number
    }
  ],
  "cardioTrainingRow": [
    {
      "Training_Type": "Cardio",
      "estimated_calories": number,
      "cardio_type": string,
      "display_distance": string,
      "display_time": string,
      "distance_meters": number,
      "time_minutes": number
    }
  ],
  "otherTrainingRow": [
    {
      "Training_Type": "Other",
      "estimated_calories": number,
      // dynamic fields chosen by you for non-strength/non-cardio activity
    }
  ],
  "estimated_calories": number,
  "trainer_notes": string,
  "isComplete": boolean
}

Rules:
- You may include rows in one or more row collections in the same session.
- Every row in every collection must include both Training_Type and estimated_calories.
- strengthTrainingRow rows:
  - Training_Type must be "Strength".
  - exercise_type:
    - Prefer matching an existing ID from exerciseEstimatorIds when it semantically fits.
    - If none fits, create a new snake_case ID in style firstword_secondword.
  - displayed_weights_metric must preserve the user's original quantity and unit string when external load is provided, for example "135 lb" or "60 kg".
  - weights_kg must be the numeric kilogram conversion of displayed_weights_metric.
  - If no additional weight is used (pushups, pullups, bodyweight squats, etc.), set displayed_weights_metric to exactly "bodyweight" and set weights_kg to 0.
  - Each row is one spreadsheet row:
    - If user says mixed set/rep patterns in one exercise (example: 2 sets of 5 reps, then 1 set of 10 reps),
      create separate rows with same exercise_type but different sets/reps.
- cardioTrainingRow rows:
  - Training_Type must be "Cardio".
  - Include cardio_type (running, biking, etc), display_distance, display_time, distance_meters, and time_minutes.
  - display_distance and display_time must preserve the exact quantity + unit the user said, for example "5 miles", "2 hours", or "2 km".
  - distance_meters and time_minutes must be the numeric conversions of those display values.
  - If a user only gave one of distance or time, preserve the one they gave and leave the missing display field as "" and the missing numeric field as 0.
  - Each row is one spreadsheet row
- otherTrainingRow rows:
  - Training_Type must be "Other".
  - Choose practical dynamic fields based on what the user described.
- trainer_notes and isComplete are session-level fields only (not per-row).
- Keep estimated_calories as a positive estimate unless the workout is clearly almost nothing.

Notes phase behavior:
- Do not ask for notes until user indicates they are done adding exercises.
- When they are done, ask: "Do you want to add any notes for your trainer?"
- If they decline notes, set trainer_notes to "" and isComplete to true.
- If they provide notes, clean lightly, preserve meaning, store in trainer_notes, and set isComplete to true.

Respond ONLY as valid JSON:
{
  "assistantMessage": "short friendly reply",
  "summary": { ...shape above... }
}
`;




  // ------------------------------
  //  Call OpenAI
  // ------------------------------
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a workout logging assistant." },
      {
        role: "user",
        content: JSON.stringify({
          instructions: prompt,
          previousSummary: session ?? null,
          history,
          message,
          exerciseEstimatorIds: Array.isArray(exerciseEstimatorIds)
            ? exerciseEstimatorIds
            : [],
        }),
      },
    ],
    max_tokens: 512,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    logger.error("Failed to parse JSON from OpenAI:", raw);
    parsed = {};
  }

  const assistantMessage =
    parsed.assistantMessage ??
    "I had trouble understanding that. Can you rephrase your workout?";
  const updatedSession = normalizeAssistantSummary(
    parsed.summary ?? session ?? null,
    {
      latestMessage: message,
      source: "chat",
      defaultDate: new Date().toISOString().slice(0, 10),
    }
  );

  return {
    botMessage: assistantMessage,
    updatedSession,
  };
}

async function handleTreadmillLoggerRequest(body: unknown): Promise<{botMessage: string; updatedSession: unknown}> {
  const apiKey = openaiApiKey.value()?.trim() ?? "";
  if (!apiKey) {
    logger.error("Missing OPENAI_API_KEY secret for treadmillLogger");
    throw new HttpsError(
      "internal",
      "Internal server error in treadmillLogger.",
      "OPENAI_API_KEY is not configured for this function."
    );
  }

  const openai = new OpenAI({ apiKey });
  const requestBody =
    body && typeof body === "object" ? body as Record<string, unknown> : {};
  const imageDataUrl = coerceImageDataUrl(requestBody["imageDataUrl"]);
  const machineType = normalizeMachineType(requestBody["machineType"]);

  if (!imageDataUrl) {
    throw new HttpsError("invalid-argument", "Missing 'imageDataUrl' in request body");
  }

  const prompt = `
You are a fitness logging assistant reading a cardio machine display photo.

Your job:
1. Extract the workout details from the image.
2. Return a workout summary that matches this cardio JSON structure:
{
  "cardioTrainingRow": [
    {
      "Training_Type": "Cardio",
      "estimated_calories": number,
      "cardio_type": string,
      "display_distance": string,
      "display_time": string,
      "distance_meters": number,
      "time_minutes": number
    }
  ],
  "estimated_calories": number,
  "trainer_notes": string,
  "isComplete": boolean
}

Rules:
- The user selected machineType as "${machineType || "unknown"}".
- Use that machineType as the primary cardio_type when it is provided and semantically fits the image.
- cardio_type should use the same snake_case style used by the chatbot flow, such as "running", "biking", "rowing", "elliptical", "stairs", or "generic_cardio".
- Preserve the exact visible distance text in display_distance, such as "3.25 mi" or "5 km".
- Preserve the exact visible time text in display_time, such as "28:14", "45 min", or "1:05:32".
- Convert distance into distance_meters.
- Convert time into time_minutes.
- estimated_calories must be a positive number when calories are visible or reasonably inferable from the screen. If calories are visible, use that value.
- trainer_notes must be "".
- isComplete should be true when a usable cardio row is extracted.
- If the image is blurry, cropped, or unreadable, return an empty cardioTrainingRow array, estimated_calories 0, trainer_notes "", isComplete false, and ask for a clearer image.
- Respond only with valid JSON in this exact envelope:
{
  "assistantMessage": "short user-facing message",
  "summary": { ... }
}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract treadmill workout data from treadmill display images and return JSON only.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 512,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error("Failed to parse JSON from OpenAI treadmillLogger:", raw);
    parsed = {};
  }

  const emptySummary = buildEmptyTreadmillSummary();
  const assistantMessage =
    parsed.assistantMessage ??
    "I couldn't read the treadmill display clearly. Please retake the photo.";
  const updatedSession = normalizeAssistantSummary(
    parsed.summary ?? emptySummary,
    {
      latestMessage: "",
      source: "treadmill_logger",
      defaultDate: new Date().toISOString().slice(0, 10),
      cardioTypeFallback: machineType || undefined,
    }
  );
  logger.info("treadmillLogger parsed cardio JSON", {
    machineType,
    updatedSession,
  });

  return {
    botMessage: assistantMessage,
    updatedSession,
  };
}

// ------------------------------
//  Cloud Function: workoutChat (HTTP fallback)
// ------------------------------
export const workoutChat = onRequest({secrets: [openaiApiKey]}, async (req, res) => {
  logger.info("workoutChat called", { method: req.method });

  // ----- CORS -----
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const response = await handleWorkoutChatRequest(req.body);
    res.status(200).json(response);
  } catch (error: any) {
    logger.error("Error in workoutChat:", error);
    const details = error instanceof HttpsError
      ? error.details ?? error.message
      : error?.message ?? String(error);
    const statusCode = error instanceof HttpsError && error.code === "invalid-argument"
      ? 400
      : 500;

    res.status(statusCode).json({
      error: "Internal server error in workoutChat.",
      details,
    });
  }
});

// ------------------------------
//  Cloud Function: workoutChatCallable
// ------------------------------
export const workoutChatCallable = onCall({secrets: [openaiApiKey]}, async (request) => {
  logger.info("workoutChatCallable called");

  try {
    return await handleWorkoutChatRequest(request.data);
  } catch (error: any) {
    logger.error("Error in workoutChatCallable:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Internal server error in workoutChat.",
      error?.message ?? String(error)
    );
  }
});

// ------------------------------
//  Cloud Function: treadmillLogger (HTTP fallback)
// ------------------------------
export const treadmillLogger = onRequest({secrets: [openaiApiKey]}, async (req, res) => {
  logger.info("treadmillLogger called", { method: req.method });

  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const response = await handleTreadmillLoggerRequest(req.body);
    res.status(200).json(response);
  } catch (error: any) {
    logger.error("Error in treadmillLogger:", error);
    const details = error instanceof HttpsError
      ? error.details ?? error.message
      : error?.message ?? String(error);
    const statusCode = error instanceof HttpsError && error.code === "invalid-argument"
      ? 400
      : 500;

    res.status(statusCode).json({
      error: "Internal server error in treadmillLogger.",
      details,
    });
  }
});

// ------------------------------
//  Cloud Function: treadmillLoggerCallable
// ------------------------------
export const treadmillLoggerCallable = onCall({secrets: [openaiApiKey]}, async (request) => {
  logger.info("treadmillLoggerCallable called");

  try {
    return await handleTreadmillLoggerRequest(request.data);
  } catch (error: any) {
    logger.error("Error in treadmillLoggerCallable:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Internal server error in treadmillLogger.",
      error?.message ?? String(error)
    );
  }
});

export const sendApnsNotification = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required to send notifications.");
  }

  const requestData =
    request.data && typeof request.data === "object" ? request.data as Record<string, unknown> : {};
  const userId = normalizeStringValue(requestData["userId"]);
  const title = normalizeStringValue(requestData["title"]);
  const body = normalizeStringValue(requestData["body"]);
  const data = requestData["data"] && typeof requestData["data"] === "object"
    ? requestData["data"] as Record<string, unknown>
    : undefined;

  if (!userId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }

  const tokens = await loadPushTokensForUser(userId);
  if (tokens.length === 0) {
    logger.info("sendApnsNotification: no push tokens found", {userId});
    return {
      success: true,
      sentCount: 0,
      failedCount: 0,
      skipped: true,
      reason: "no-push-tokens",
    };
  }

  const messaging = getMessaging();
  const stringData = normalizeNotificationData(data);
  const silent = stringData["silent"] === "true";

  const multicastMessage = {
    tokens,
    ...(silent ? {} : {
      notification: {
        title: title || "Atlas Notification",
        body,
      },
    }),
    data: stringData,
    apns: {
      headers: {
        "apns-priority": silent ? "5" : "10",
      },
      payload: {
        aps: {
          ...(silent ? {"content-available": 1} : {}),
          ...(stringData["mutableContent"] === "true" ? {"mutable-content": 1} : {}),
          ...(stringData["category"] ? {category: stringData["category"]} : {}),
          sound: silent ? undefined : "default",
        },
      },
    },
  };

  const response = await messaging.sendEachForMulticast(multicastMessage);
  const invalidTokens = response.responses
    .map((sendResponse, index) => ({sendResponse, token: tokens[index]}))
    .filter(({sendResponse}) =>
      !sendResponse.success &&
      !!sendResponse.error &&
      (
        sendResponse.error.code === "messaging/invalid-registration-token" ||
        sendResponse.error.code === "messaging/registration-token-not-registered"
      )
    )
    .map(({token}) => token);

  if (invalidTokens.length > 0) {
    logger.warn("sendApnsNotification: invalid push tokens detected", {
      userId,
      invalidTokens,
    });
  }

  return {
    success: response.failureCount === 0,
    sentCount: response.successCount,
    failedCount: response.failureCount,
    invalidTokens,
  };
});
