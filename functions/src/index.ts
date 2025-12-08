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
You are a friendly AI fitness coach. Help users clean up messy workout logs,
interpret what they did, extract relevant workout details, and ask clarifying
follow-up questions when needed.

Current structured session:
${JSON.stringify(session)}

Recent chat history:
${JSON.stringify(history)}

User message:
"${message}"

Respond ONLY with conversational text. Do NOT return JSON here.
`;

    // ------------------------------
    //  Call OpenAI
    // ------------------------------
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You are a workout logging assistant." },
        { role: "user", content: prompt },
      ],
      max_tokens: 256,
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      "Sorry, I couldn't generate a response.";

    // ------------------------------
    //  Respond to frontend
    // ------------------------------
    res.status(200).json({
      reply,
    });
  } catch (error: any) {
    logger.error("Error in workoutChat:", error);

    res.status(500).json({
      error: "Internal server error in workoutChat.",
      details: error?.message ?? String(error),
    });
  }
});
