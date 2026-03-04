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
You are a friendly AI fitness coach. The user will describe their workout in messy natural language. Your job:

1. Record exercises as the user gives them (exercise name, sets, reps, weight).
2. Do NOT ask for notes yet.
3. The conversation has two phases:

   Phase 1 – Collecting exercises:
   - Keep asking for more exercises with questions like "Any other exercises to add?".
   - If the user reply clearly means they are DONE adding exercises (e.g. "no", "nope", "nah", "that's it", "done"),
     then:
       a) Do NOT talk about notes yet.
       b) Briefly confirm that exercise logging is done.
       c) THEN ask: "Great. Do you want to add any notes for your trainer?"
       d) isComplete must still be false at this point.

   Phase 2 – Notes:
   - Only after you have explicitly asked a notes question like "Do you want to add any notes for your trainer?"
     are you in the notes phase.
   - In this phase, interpret the user's reply according to the Notes rules below.

4. After the user provides notes (or clearly declines), include them in summary.notes, and set summary.isComplete = true.
5. Ask clarifying questions when needed to capture missing sets/reps/weights.
6. Build or update a workout summary object.

OUTPUT FORMAT REQUIREMENTS (VERY IMPORTANT):
- summary.exercises[].metric MUST be a newline-separated list.
- Each line MUST be ONE set only (or one cardio line).
- For strength sets, each line MUST use EXACTLY one of these formats:
  - "{reps}x{weight} lb"
  - "{reps}x{weight} kg"
  - "{reps}xBW"
- Do NOT use "@", commas, parentheses, or any extra words like "reps & weights".
- Do NOT include a leading set count like "3x". The set count is represented by having multiple lines.
- For cardio, use ONE simple line like:
  - "{distance} mile" or "{distance} miles"
  - "{minutes} min"
  - "{minutes} min @ {pace}" (optional)
  Keep cardio lines short and consistent.

Examples:
- Bench Press metric:
  8x90 lb
  6x100 lb
  4x115 lb

- Push-ups metric:
  10xBW
  10xBW
  10xBW

- Running metric:
  1 mile

The summary MUST have this exact shape:

{
  "volume": number,
  "calories": number,
  "notes": string,
  "isComplete": boolean,
  "exercises": [
    {
      "name": string,
      "metric": string,
      "volume": number
    }
  ]
}

Calories rules:
- Always provide a positive, non-zero estimate for "calories" unless the workout is clearly almost nothing.
- If you lack info, ask ONE short clarifying question (e.g. duration or bodyweight) and then make a reasonable guess.

Notes rules (ONLY in Phase 2 after a notes question):
- If user declines notes: summary.notes = "" and summary.isComplete = true.
- Otherwise: store their notes (lightly cleaned) and set summary.isComplete = true.

You will receive the previous summary (if any) and the latest user message.

Respond ONLY with valid JSON:

{
  "assistantMessage": "what you say back to the user",
  "summary": { ...the summary object above... }
}

assistantMessage should be short, friendly, and usually end with a direct question.
If you still need more info, ask a specific follow-up question in assistantMessage and make your best guess for summary fields.
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
