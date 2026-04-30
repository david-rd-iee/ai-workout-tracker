import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const sharedStringFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "city",
  "state",
];

const sharedNumberFields = ["zip"];
const profileImageFields = ["profilepic", "profilePic", "profileImage"];

type FirestoreRecord = Record<string, unknown>;

export const syncTrainerProfileFromUsers = onDocumentWritten(
  "users/{trainerId}",
  async (event) => {
    const trainerId = String(event.params.trainerId ?? "").trim();
    if (!trainerId) {
      return;
    }

    const before = toRecord(event.data?.before?.data());
    const after = toRecord(event.data?.after?.data());
    const trainerRef = admin.firestore().doc(`trainers/${trainerId}`);

    if (!event.data?.after?.exists) {
      await trainerRef.delete();
      logger.info("[TrainerProfileSync] Deleted mirrored trainer profile after user doc deletion.", {
        trainerId,
      });
      return;
    }

    if (!isTrainerUser(after)) {
      if (isTrainerUser(before)) {
        await trainerRef.delete();
        logger.info("[TrainerProfileSync] Removed trainer mirror after account stopped being a trainer.", {
          trainerId,
        });
      }
      return;
    }

    const trainerSnap = await trainerRef.get();
    const trainerData = trainerSnap.exists ? toRecord(trainerSnap.data()) : {};
    const patch = buildTrainerMirrorPatch(after, trainerData);

    if (!Object.keys(patch).length) {
      return;
    }

    await trainerRef.set(
      {
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("[TrainerProfileSync] Mirrored shared trainer fields from users/{trainerId}.", {
      trainerId,
      fields: Object.keys(patch),
    });
  }
);

export const enforceTrainerProfileMirror = onDocumentWritten(
  "trainers/{trainerId}",
  async (event) => {
    const trainerId = String(event.params.trainerId ?? "").trim();
    if (!trainerId || !event.data?.after?.exists) {
      return;
    }

    const userSnap = await admin.firestore().doc(`users/${trainerId}`).get();
    if (!userSnap.exists) {
      return;
    }

    const userData = toRecord(userSnap.data());
    if (!isTrainerUser(userData)) {
      return;
    }

    const trainerData = toRecord(event.data.after.data());
    const patch = buildTrainerMirrorPatch(userData, trainerData);
    if (!Object.keys(patch).length) {
      return;
    }

    await admin.firestore().doc(`trainers/${trainerId}`).set(
      {
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("[TrainerProfileSync] Reconciled trainer profile back to the users source of truth.", {
      trainerId,
      fields: Object.keys(patch),
    });
  }
);

function buildTrainerMirrorPatch(source: FirestoreRecord, current: FirestoreRecord): FirestoreRecord {
  const patch: FirestoreRecord = {};

  for (const field of sharedStringFields) {
    applyStringFieldPatch(patch, source, current, field);
  }

  for (const field of sharedNumberFields) {
    applyNumberFieldPatch(patch, source, current, field);
  }

  applyProfileImagePatch(patch, source, current);

  return patch;
}

function applyStringFieldPatch(
  patch: FirestoreRecord,
  source: FirestoreRecord,
  current: FirestoreRecord,
  field: string
): void {
  const nextValue = readString(source[field]);
  const currentValue = readString(current[field]);
  const sourceHadField = hasOwnField(source, field);

  if (nextValue) {
    if (currentValue !== nextValue) {
      patch[field] = nextValue;
    }
    return;
  }

  if (sourceHadField && currentValue) {
    patch[field] = admin.firestore.FieldValue.delete();
  }
}

function applyNumberFieldPatch(
  patch: FirestoreRecord,
  source: FirestoreRecord,
  current: FirestoreRecord,
  field: string
): void {
  const nextValue = readPositiveInteger(source[field]);
  const currentValue = readPositiveInteger(current[field]);
  const sourceHadField = hasOwnField(source, field);

  if (nextValue !== null) {
    if (currentValue !== nextValue) {
      patch[field] = nextValue;
    }
    return;
  }

  if (sourceHadField && currentValue !== null) {
    patch[field] = admin.firestore.FieldValue.delete();
  }
}

function applyProfileImagePatch(
  patch: FirestoreRecord,
  source: FirestoreRecord,
  current: FirestoreRecord
): void {
  const nextValue = readFirstString(source, profileImageFields);
  const currentValue = readFirstString(current, profileImageFields);
  const sourceHadAnyImageField = profileImageFields.some((field) => hasOwnField(source, field));

  if (nextValue) {
    if (currentValue !== nextValue) {
      for (const field of profileImageFields) {
        patch[field] = nextValue;
      }
    }
    return;
  }

  if (sourceHadAnyImageField && currentValue) {
    for (const field of profileImageFields) {
      patch[field] = admin.firestore.FieldValue.delete();
    }
  }
}

function isTrainerUser(data: FirestoreRecord): boolean {
  return (
    data["isPT"] === true ||
    readString(data["requestedAccountType"]).toLowerCase() === "trainer" ||
    hasOwnField(data, "trainerApprovalStatus")
  );
}

function readFirstString(source: FirestoreRecord, keys: string[]): string {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function hasOwnField(source: FirestoreRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function toRecord(value: unknown): FirestoreRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as FirestoreRecord;
}
