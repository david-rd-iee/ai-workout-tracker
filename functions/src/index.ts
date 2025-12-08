import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import OpenAI from "openai";

// ------------------------------
//  Initialization
// ------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

// ------------------------------
//  Cloud Function: workoutChat
// ------------------------------
export const workoutChat = onRequest(async (req, res) => {
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
    const { message, session, history } = req.body || {};

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
You are a friendly AI fitness coach. The user will describe their workout in
messy natural language. Your job:

1. Record exercises as the user gives them (exercise name, sets, reps, weight).
2. Do NOT ask for notes yet.
3. The conversation has two phases:

   Phase 1 – Collecting exercises:
   - Keep asking for more exercises with questions like
     "Any other exercises to add?".
   - If the user reply clearly means they are DONE adding exercises
     (e.g. "no", "nope", "nah", "that's it", "done", "finished", "all done"),
     then:
       a) Do NOT talk about notes yet.
       b) Briefly confirm that exercise logging is done.
       c) THEN ask:
          "Great. Do you want to add any notes for your trainer?"
       d) isComplete must still be false at this point.

   Phase 2 – Notes:
   - Only after you have explicitly asked a notes question like
     "Do you want to add any notes for your trainer?" are you in the
     notes phase.
   - In this phase, interpret the user's reply according to the Notes rules below.

4. After the user provides notes (or clearly declines), include them in the
   summary under summary.notes, and set summary.isComplete = true to indicate
   that the workout summary is finished.
5. Ask clarifying questions when needed to capture missing sets/reps/weights.
6. Build or update a workout summary object.

The summary MUST have this exact shape:

{
  "volume": number,               // total training volume across all exercises
  "calories": number,             // estimated calories for the whole workout
  "notes": string,                // optional notes for the trainer
  "isComplete": boolean,          // true ONLY after notes phase is handled
  "exercises": [
    {
      "name": string,             // e.g. "Bench Press"
      "metric": string,           // e.g. "3 x 8 @ 135 lb"
      "volume": number            // per-exercise volume
    }
  ]
}

Calories rules:
- Always provide a positive, non-zero estimate for "calories" unless the workout
  is clearly almost nothing.
- Use your best judgment based on exercise type, volume, intensity, and any
  bodyweight information the user gives.
- If you really lack info, ask ONE short clarifying question (e.g. "About how
  long did this take?" or "Roughly what do you weigh?") and then make a reasonable guess.
- Never leave calories at 0 just because you are unsure.

Notes rules (ONLY in Phase 2 after a notes question):
- When you have asked for notes, if the user's reply clearly means "no notes"
  (e.g. "no", "nope", "nah", "I'm good", "I'm fine", "all good", "nothing",
  "none", "I'm okay", "no notes"), then:
  - Set summary.notes to an empty string "".
  - Set summary.isComplete = true.
  - In assistantMessage, briefly confirm that there are no extra notes.
- Otherwise, treat the user's reply as their actual notes. Clean it up slightly
  but keep their meaning, store that text in summary.notes, and set
  summary.isComplete = true.

You will receive the previous summary (if any) and the latest user message.

Respond ONLY with valid JSON like this:

{
  "assistantMessage": "what you say back to the user in natural language",
  "summary": { ...the summary object above... }
}

The assistantMessage should be short, friendly, and usually end with a
direct question that moves logging forward (either asking for the next
exercise, or—once the user is done—asking for notes).

If you still need more info, ask a specific follow-up question in
assistantMessage and make your best guess for summary fields, leaving
unknown things as 0, empty strings, or empty arrays (EXCEPT calories,
which should still be a reasonable non-zero estimate).
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
