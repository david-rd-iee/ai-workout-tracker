import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import OpenAI from "openai";

const openaiApiKey = defineSecret("OPENAI_API_KEY");

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

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  }

  if (value && typeof value === "object") {
    return [value as Record<string, unknown>];
  }

  return [];
}

function normalizeSummaryRows(summary: unknown, latestMessage: string): unknown {
  if (!summary || typeof summary !== "object") {
    return summary;
  }

  const summaryRecord = summary as Record<string, unknown>;
  const sessionEstimatedCalories = toPositiveNumber(summaryRecord["estimated_calories"]) ?? 0;
  const legacyRows = toObjectArray(summaryRecord["trainingRows"]);
  const legacyStrengthRows = legacyRows.filter((row) =>
    String(row["Training_Type"] ?? row["training_type"] ?? row["trainingType"] ?? "")
      .trim()
      .toLowerCase() === "strength"
  );
  const legacyCardioRows = legacyRows.filter((row) =>
    String(row["Training_Type"] ?? row["training_type"] ?? row["trainingType"] ?? "")
      .trim()
      .toLowerCase() === "cardio"
  );
  const legacyOtherRows = legacyRows.filter((row) =>
    String(row["Training_Type"] ?? row["training_type"] ?? row["trainingType"] ?? "")
      .trim()
      .toLowerCase() === "other"
  );

  const strengthSource =
    summaryRecord["strengthTrainingRow"] ??
    summaryRecord["strengthTrainingRowss"] ??
    legacyStrengthRows;
  const strengthRows = toObjectArray(strengthSource).map((row) => {
    const normalized = {...row};
    normalized["Training_Type"] = "Strength";
    normalized["estimated_calories"] = toPositiveNumber(
      row["estimated_calories"] ?? row["estimatedCalories"]
    ) ?? 0;
    return normalized;
  });

  const rawRows =
    summaryRecord["cardioTrainingRow"] ??
    legacyCardioRows.map((row) => ({
      cardio_type:
        row["cardio_type"] ??
        row["cardioType"] ??
        row["exercise_type"] ??
        row["exersice_type"] ??
        row["type"],
      distance_input:
        row["distance_input"] ??
        row["distanceText"] ??
        row["distance_text"],
      time_input:
        row["time_input"] ??
        row["timeText"] ??
        row["time_text"],
      distance:
        row["distance"] ??
        row["distance_meters"] ??
        row["meters"],
      time:
        row["time"] ??
        row["minutes"] ??
        row["duration"] ??
        row["reps"],
      estimated_calories:
        row["estimated_calories"] ??
        row["estimatedCalories"],
    }));
  const cardioRows = toObjectArray(rawRows);

  const fromMessage = extractDistanceAndTimeFromMessage(latestMessage);
  const fromMessageText = extractDistanceAndTimeTokensFromMessage(latestMessage);
  const inferredCardioType = inferCardioTypeFromMessage(latestMessage);
  if (
    cardioRows.length === 0 &&
    inferredCardioType &&
    (typeof fromMessage.distance === "number" || typeof fromMessage.time === "number")
  ) {
    cardioRows.push({
      cardio_type: inferredCardioType,
      distance_input: fromMessageText.distanceText,
      time_input: fromMessageText.timeText,
      distance: fromMessage.distance,
      time: fromMessage.time,
      estimated_calories: 0,
    });
  }

  const normalizedRows = cardioRows.map((entry, index) => {
    const row = {...entry};
    const rowCardioType = String(
      row["cardio_type"] ??
      row["cardioType"] ??
      row["exercise_type"] ??
      row["type"] ??
      ""
    ).trim();
    const rowDistanceInput = String(
      row["distance_input"] ??
      row["distanceText"] ??
      row["distance_text"] ??
      ""
    ).trim();
    const rowTimeInput = String(
      row["time_input"] ??
      row["timeText"] ??
      row["time_text"] ??
      ""
    ).trim();
    const rowDistance =
      extractDistanceMeters(row["distance"]) ??
      extractDistanceMeters(row["distance_meters"]) ??
      extractDistanceMeters(row["meters"]);
    const rowTime =
      extractTimeMinutes(row["time"]) ??
      extractTimeMinutes(row["minutes"]) ??
      extractTimeMinutes(row["duration"]);

    const distance = index === 0 && typeof fromMessage.distance === "number"
      ? fromMessage.distance
      : rowDistance;
    const time = index === 0 && typeof fromMessage.time === "number"
      ? fromMessage.time
      : rowTime;

    row["Training_Type"] = "Cardio";
    row["cardio_type"] = rowCardioType || inferredCardioType || "cardio_activity";
    const distanceInput = rowDistanceInput || (index === 0 ? fromMessageText.distanceText : undefined);
    const timeInput = rowTimeInput || (index === 0 ? fromMessageText.timeText : undefined);
    if (distanceInput) {
      row["distance_input"] = distanceInput;
    } else {
      delete row["distance_input"];
    }
    if (timeInput) {
      row["time_input"] = timeInput;
    } else {
      delete row["time_input"];
    }
    row["estimated_calories"] = toPositiveNumber(
      row["estimated_calories"] ?? row["estimatedCalories"]
    ) ?? 0;
    row["distance"] = typeof distance === "number" ? distance : null;
    row["time"] = typeof time === "number" ? time : null;
    return row;
  });

  const otherSource = summaryRecord["otherTrainingRow"] ?? legacyOtherRows;
  const otherRows = toObjectArray(otherSource).map((row) => {
    const normalized = {...row};
    normalized["Training_Type"] = "Other";
    normalized["estimated_calories"] = toPositiveNumber(
      row["estimated_calories"] ?? row["estimatedCalories"]
    ) ?? 0;
    return normalized;
  });

  const allRows = [...strengthRows, ...normalizedRows, ...otherRows];
  if (allRows.length > 0) {
    const fallbackPerRow = sessionEstimatedCalories > 0
      ? Math.max(1, Math.round(sessionEstimatedCalories / allRows.length))
      : 0;
    allRows.forEach((row) => {
      const rowCalories = toPositiveNumber(row["estimated_calories"]) ?? 0;
      if (rowCalories <= 0) {
        row["estimated_calories"] = fallbackPerRow;
      }
    });
  }

  if (!summaryRecord["Training_Type"]) {
    const distinctTypes = new Set(
      allRows.map((row) => String(row["Training_Type"] ?? "").trim()).filter(Boolean)
    );
    if (distinctTypes.size === 1) {
      summaryRecord["Training_Type"] = Array.from(distinctTypes)[0];
    }
  }

  summaryRecord["strengthTrainingRow"] = strengthRows;
  summaryRecord["strengthTrainingRowss"] = strengthRows;
  summaryRecord["cardioTrainingRow"] = normalizedRows;
  summaryRecord["otherTrainingRow"] = otherRows;
  summaryRecord["trainingRows"] = [
    ...strengthRows,
    ...normalizedRows.map((row) => ({
      Training_Type: "Cardio",
      estimated_calories: row["estimated_calories"],
      exercise_type:
        row["cardio_type"] ??
        row["exercise_type"] ??
        "cardio_activity",
      sets: 1,
      reps:
        toPositiveNumber(row["time"]) ??
        toPositiveNumber(row["distance"]) ??
        0,
      weights: "body weight",
    })),
    ...otherRows.map((row) => ({
      Training_Type: "Other",
      estimated_calories: row["estimated_calories"],
      exercise_type:
        row["exercise_type"] ??
        row["activity"] ??
        row["name"] ??
        "other_activity",
      sets: row["sets"] ?? 1,
      reps: row["reps"] ?? row["time"] ?? 1,
      weights: row["weights"] ?? "body weight",
    })),
  ];
  return summaryRecord;
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
      "weights": number | "body weight"
    }
  ],
  "cardioTrainingRow": [
    {
      "Training_Type": "Cardio",
      "estimated_calories": number,
      "cardio_type": string,
      "distance": number, // meters
      "time": number // minutes
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
  - weights must be in kg when numeric.
  - If no additional weight is used (pushups, pullups, bodyweight squats, etc.), set weights to "body weight".
  - Each row is one spreadsheet row:
    - If user says mixed set/rep patterns in one exercise (example: 2 sets of 5 reps, then 1 set of 10 reps),
      create separate rows with same exercise_type but different sets/reps.
- cardioTrainingRow rows:
  - Training_Type must be "Cardio".
  - Include cardio_type (running, biking, etc), distance in meters when available, and time in minutes when available.
  - If time is given not in minutes, convert it to minutes from the given metric, then log it.
  - If the distance is not given in meters, convert it to meters from the given metric and log it in minutes.
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
  const updatedSession = normalizeSummaryRows(
    parsed.summary ?? session ?? null,
    message
  );

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
