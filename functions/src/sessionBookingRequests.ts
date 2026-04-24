import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const WEEKDAY_LONG = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface RequestSessionBookingResponse {
  bookingId: string;
  status: "pending";
}

export const requestSessionBooking = onCall(
  async (request): Promise<RequestSessionBookingResponse> => {
    const authUid = normalizeString(request.auth?.uid);
    if (!authUid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const payload = toRecord(request.data);
    const trainerId = normalizeString(payload["trainerId"]);
    const clientId = normalizeString(payload["clientId"]);
    const date = normalizeDate(payload["date"]);
    const time = normalizeTime(payload["time"]);
    const duration = normalizeDuration(payload["duration"]);
    const price = normalizePrice(payload["price"]);

    if (!trainerId || !clientId || !date || !time || !duration) {
      throw new HttpsError("invalid-argument", "trainerId, clientId, date, time, and duration are required.");
    }

    if (authUid !== clientId) {
      throw new HttpsError("permission-denied", "Client identity mismatch.");
    }

    const bookingId = `${trainerId}_${clientId}_${date}_${time.replace(/\s+/g, "")}`;
    const trainerAvailabilityRef = db.doc(`trainerAvailability/${trainerId}`);
    const bookingRef = db.doc(`bookings/${bookingId}`);

    try {
      await db.runTransaction(async (transaction) => {
        const [trainerAvailabilitySnap, existingBookingSnap] = await Promise.all([
          transaction.get(trainerAvailabilityRef),
          transaction.get(bookingRef),
        ]);

        if (!trainerAvailabilitySnap.exists) {
          throw new HttpsError("failed-precondition", "No availability on that day.");
        }

        const trainerAvailabilityData = toRecord(trainerAvailabilitySnap.data());
        validateSessionInsideTrainerAvailability(trainerAvailabilityData["availability"], date, time, duration);
        validateNoBookedSessionOverlap(trainerAvailabilityData["bookedSessions"], date, time, duration);

        if (existingBookingSnap.exists) {
          const existingStatus = normalizeString(existingBookingSnap.get("status")).toLowerCase();
          if (existingStatus !== "cancelled") {
            throw new HttpsError("already-exists", "This slot is already requested or booked.");
          }
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const endTime = normalizeTime(payload["endTime"]) || calculateEndTime(time, duration);
        const sessionType = normalizeString(payload["sessionType"]);
        const notes = normalizeString(payload["notes"]);
        const trainerFirstName = normalizeString(payload["trainerFirstName"]);
        const trainerLastName = normalizeString(payload["trainerLastName"]);
        const trainerProfilePic = normalizeString(payload["trainerProfilePic"]);
        const clientFirstName = normalizeString(payload["clientFirstName"]);
        const clientLastName = normalizeString(payload["clientLastName"]);
        const clientProfilePic = normalizeString(payload["clientProfilePic"]);

        transaction.set(bookingRef, {
          bookingId,
          trainerId,
          clientId,
          trainerFirstName,
          trainerLastName,
          trainerProfilePic,
          clientFirstName,
          clientLastName,
          clientProfilePic,
          date,
          time,
          endTime,
          duration,
          price,
          status: "pending",
          requestedBy: "client",
          requestType: "session_request",
          sessionType,
          notes,
          createdAt: now,
          updatedAt: now,
        });

        const bookedSession = {
          bookingId,
          trainerId,
          clientId,
          trainerFirstName,
          trainerLastName,
          trainerProfilePic,
          clientFirstName,
          clientLastName,
          clientProfilePic,
          date,
          time,
          startTime: time,
          endTime,
          duration,
          status: "pending",
          requestedBy: "client",
          requestType: "session_request",
          sessionType,
          notes,
        };

        const existingBookedSessions = Array.isArray(trainerAvailabilityData["bookedSessions"]) ?
          [...trainerAvailabilityData["bookedSessions"] as unknown[]] :
          [];
        existingBookedSessions.push(bookedSession);

        transaction.set(
          trainerAvailabilityRef,
          {
            bookedSessions: existingBookedSessions,
            updatedAt: now,
          },
          {merge: true}
        );
      });
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const errorCode = normalizeString((error as {code?: unknown})?.code).toLowerCase();
      const errorMessage = normalizeString((error as {message?: unknown})?.message);
      if (errorCode.includes("already-exists") || errorMessage.includes("already requested or booked")) {
        throw new HttpsError("already-exists", "This slot is already requested or booked.");
      }
      if (
        errorCode.includes("failed-precondition") ||
        errorMessage.includes("No availability on that day.") ||
        errorMessage.includes("Selected time is outside trainer availability.")
      ) {
        if (errorMessage.includes("No availability on that day.")) {
          throw new HttpsError("failed-precondition", "No availability on that day.");
        }
        throw new HttpsError("failed-precondition", "Selected time is outside trainer availability.");
      }

      logger.error("[SessionBookingRequests] requestSessionBooking failed.", {
        trainerId,
        clientId,
        date,
        time,
        error,
      });
      throw new HttpsError("internal", "Booking transaction failed. Please try again.");
    }

    return {
      bookingId,
      status: "pending",
    };
  }
);

function validateSessionInsideTrainerAvailability(
  rawAvailability: unknown,
  date: string,
  time: string,
  duration: number
): void {
  const requestedRange = getSessionRangeInMinutes(time, duration);
  if (!requestedRange) {
    throw new HttpsError("failed-precondition", "Selected time is outside trainer availability.");
  }

  const windows = getAvailabilityWindowsForDate(rawAvailability, date);
  if (!windows.length) {
    throw new HttpsError("failed-precondition", "No availability on that day.");
  }

  const insideWindow = windows.some((window) =>
    requestedRange.start >= window.start && requestedRange.end <= window.end
  );
  if (!insideWindow) {
    throw new HttpsError("failed-precondition", "Selected time is outside trainer availability.");
  }
}

function validateNoBookedSessionOverlap(
  rawBookedSessions: unknown,
  date: string,
  time: string,
  duration: number
): void {
  const requestedRange = getSessionRangeInMinutes(time, duration);
  if (!requestedRange) {
    throw new HttpsError("failed-precondition", "Selected time is outside trainer availability.");
  }

  const bookedSessions = Array.isArray(rawBookedSessions) ? rawBookedSessions : [];
  const hasOverlap = bookedSessions.some((session) => {
    const record = toRecord(session);
    const sessionDate = normalizeDate(record["date"]);
    if (sessionDate !== date) {
      return false;
    }

    const status = normalizeString(record["status"]).toLowerCase();
    if (status === "cancelled") {
      return false;
    }

    const existingRange = getSessionRangeFromSessionRecord(record);
    return !!existingRange && rangesOverlap(requestedRange, existingRange);
  });

  if (hasOverlap) {
    throw new HttpsError("already-exists", "This slot is already requested or booked.");
  }
}

function getAvailabilityWindowsForDate(
  rawAvailability: unknown,
  date: string
): Array<{start: number; end: number}> {
  const dayNames = getDayNames(date);
  if (!dayNames) {
    return [];
  }

  const entries = normalizeAvailabilityEntries(rawAvailability);
  const entry = entries.find((candidate) => {
    const candidateDay = candidate.day.toLowerCase();
    return candidateDay === dayNames.long || candidateDay === dayNames.short;
  });

  if (!entry || entry.available === false) {
    return [];
  }

  return entry.timeWindows
    .map((window) => {
      const start = parseTimeToMinutes(window.startTime);
      const end = parseTimeToMinutes(window.endTime);
      if (start === null || end === null || end <= start) {
        return null;
      }
      return {start, end};
    })
    .filter((window): window is {start: number; end: number} => !!window);
}

function normalizeAvailabilityEntries(rawAvailability: unknown): Array<{
  day: string;
  available: boolean;
  timeWindows: Array<{startTime: string; endTime: string}>;
}> {
  if (Array.isArray(rawAvailability)) {
    return rawAvailability.map((entry) => {
      const record = toRecord(entry);
      return {
        day: normalizeString(record["day"]),
        available: record["available"] !== false,
        timeWindows: extractAvailabilityTimeWindows(record["timeWindows"] ?? record["times"]),
      };
    });
  }

  if (!rawAvailability || typeof rawAvailability !== "object" || Array.isArray(rawAvailability)) {
    return [];
  }

  return Object.entries(rawAvailability as Record<string, unknown>).map(([day, windows]) => ({
    day: normalizeString(day),
    available: Array.isArray(windows) ? windows.length > 0 : Boolean(windows),
    timeWindows: extractAvailabilityTimeWindows(windows),
  }));
}

function extractAvailabilityTimeWindows(
  rawWindows: unknown
): Array<{startTime: string; endTime: string}> {
  if (!Array.isArray(rawWindows)) {
    return [];
  }

  return rawWindows
    .map((window) => {
      const record = toRecord(window);
      const startTime = normalizeTime(record["startTime"] ?? record["start"]);
      const endTime = normalizeTime(record["endTime"] ?? record["end"]);
      if (!startTime || !endTime) {
        return null;
      }
      return {startTime, endTime};
    })
    .filter((window): window is {startTime: string; endTime: string} => !!window);
}

function getSessionRangeFromSessionRecord(
  session: Record<string, unknown>
): {start: number; end: number} | null {
  const startTime = normalizeTime(session["startTime"] ?? session["time"]);
  const startMinutes = parseTimeToMinutes(startTime);
  if (!startTime || startMinutes === null) {
    return null;
  }

  const endTime = normalizeTime(session["endTime"]);
  const endMinutesFromTime = parseTimeToMinutes(endTime);
  if (endTime && endMinutesFromTime !== null && endMinutesFromTime > startMinutes) {
    return {start: startMinutes, end: endMinutesFromTime};
  }

  const duration = normalizeDuration(session["duration"]);
  if (!duration) {
    return null;
  }

  return {start: startMinutes, end: startMinutes + duration};
}

function getSessionRangeInMinutes(
  startTime: string,
  duration: number
): {start: number; end: number} | null {
  const start = parseTimeToMinutes(startTime);
  if (start === null || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return {start, end: start + duration};
}

function rangesOverlap(
  first: {start: number; end: number},
  second: {start: number; end: number}
): boolean {
  return first.start < second.end && second.start < first.end;
}

function parseTimeToMinutes(time: string): number | null {
  const normalized = normalizeTime(time);
  if (!normalized) {
    return null;
  }

  const amPmMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (amPmMatch) {
    let hour = Number.parseInt(amPmMatch[1], 10);
    const minute = Number.parseInt(amPmMatch[2], 10);
    const period = amPmMatch[3].toUpperCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (period === "PM" && hour < 12) {
      hour += 12;
    } else if (period === "AM" && hour === 12) {
      hour = 0;
    }
    return hour * 60 + minute;
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hour = Number.parseInt(twentyFourHourMatch[1], 10);
    const minute = Number.parseInt(twentyFourHourMatch[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return hour * 60 + minute;
  }

  return null;
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const startMinutes = parseTimeToMinutes(startTime);
  if (startMinutes === null) {
    return startTime;
  }

  const totalMinutes = startMinutes + durationMinutes;
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function getDayNames(date: string): {long: string; short: string} | null {
  const normalized = normalizeDate(date);
  if (!normalized) {
    return null;
  }

  const dateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return null;
  }

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const weekdayIndex = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  const long = WEEKDAY_LONG[weekdayIndex];
  return {long, short: long.slice(0, 3)};
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDate(value: unknown): string {
  const direct = normalizeString(value);
  if (!direct) {
    return "";
  }

  const directMatch = direct.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(direct);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().split("T")[0];
}

function normalizeTime(value: unknown): string {
  return normalizeString(value);
}

function normalizeDuration(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.round(parsed);
}

function normalizePrice(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 75;
  }
  return parsed;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
