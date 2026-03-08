import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import OpenAI from "openai";

const openaiApiKey = defineSecret("OPENAI_API_KEY");

// ------------------------------
//  Cloud Function: workoutChat
// ------------------------------
export const workoutChat = onRequest({secrets: [openaiApiKey]}, async (req, res) => {
  logger.info("workoutChat called", { method: req.method });

  // ----- CORS -----
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  // Allow OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const apiKey = openaiApiKey.value()?.trim() ?? "";
    if (!apiKey) {
      logger.error("Missing OPENAI_API_KEY secret for workoutChat");
      res.status(500).json({
        error: "Internal server error in workoutChat.",
        details: "OPENAI_API_KEY is not configured for this function.",
      });
      return;
    }

    const openai = new OpenAI({ apiKey });

    const { message, session, history, exerciseEstimatorIds } = req.body || {};

    if (!message || typeof message !== "string") {
      res.status(400).json({
        error: "Missing 'message' in request body",
      });
      return;
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
  "trainingRows": [
    {
      "Training_Type": "Strength" | "Cardio" | "Other",
      "exercise_type": string,
      "sets": number,
      "reps": number,
      "weights": number | "body weight"
    }
  ],
  "estimated_calories": number,
  "trainer_notes": string,
  "isComplete": boolean
}

Rules:
- Training_Type must be exactly "Strength", "Cardio", or "Other".
- exercise_type:
  - Prefer matching an existing ID from exerciseEstimatorIds when it semantically fits.
  - If none fits, create a new snake_case ID in style firstword_secondword.
- weights must be in kg when numeric.
- If no additional weight is used (pushups, pullups, bodyweight squats, etc.), set weights to "body weight".
- Each row is one spreadsheet row:
  - If user says mixed set/rep patterns in one exercise (example: 2 sets of 5 reps, then 1 set of 10 reps),
    create separate rows with same exercise_type but different sets/reps.
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
    const updatedSession = parsed.summary ?? session ?? null;

    // ------------------------------
    //  Respond to frontend
    // ------------------------------
    res.status(200).json({
      botMessage: assistantMessage,
      updatedSession,
    });
  } catch (error: any) {
    logger.error("Error in workoutChat:", error);

    res.status(500).json({
      error: "Internal server error in workoutChat.",
      details: error?.message ?? String(error),
    });
  }
});
