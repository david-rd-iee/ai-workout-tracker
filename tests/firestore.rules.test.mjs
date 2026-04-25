import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = `ai-workout-tracker-rules-${Date.now()}`;
const rules = readFileSync('firestore.rules', 'utf8');

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

async function seedData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();

    await setDoc(doc(adminDb, 'trainers', 'trainerAssigned'), { firstName: 'Assigned' });
    await setDoc(doc(adminDb, 'trainers', 'trainerUnassigned'), { firstName: 'Unassigned' });
    await setDoc(doc(adminDb, 'users', 'clientA'), { trainerId: 'trainerAssigned' });
    await setDoc(doc(adminDb, 'clients', 'clientA'), { trainerId: 'trainerAssigned' });
    await setDoc(doc(adminDb, 'trainers', 'trainerAssigned', 'clients', 'clientA'), {
      clientId: 'clientA',
      trainerId: 'trainerAssigned',
    });
    await setDoc(doc(adminDb, 'users', 'clientA', 'workoutSummaries', '2026-04-24'), {
      date: '2026-04-24',
      eventCount: 1,
      workoutEventIds: ['evt_1'],
    });
  });
}

test.before(async () => {
  await seedData();
});

test.after(async () => {
  await testEnv.cleanup();
});

test('client can read own workout summary', async () => {
  const clientDb = testEnv.authenticatedContext('clientA').firestore();
  await assertSucceeds(getDoc(doc(clientDb, 'users', 'clientA', 'workoutSummaries', '2026-04-24')));
});

test('assigned trainer can read client workout summary', async () => {
  const trainerDb = testEnv.authenticatedContext('trainerAssigned').firestore();
  await assertSucceeds(getDoc(doc(trainerDb, 'users', 'clientA', 'workoutSummaries', '2026-04-24')));
});

test('unassigned trainer/user cannot read client workout summary', async () => {
  const trainerDb = testEnv.authenticatedContext('trainerUnassigned').firestore();
  const randomUserDb = testEnv.authenticatedContext('randomUser').firestore();

  await assertFails(getDoc(doc(trainerDb, 'users', 'clientA', 'workoutSummaries', '2026-04-24')));
  await assertFails(getDoc(doc(randomUserDb, 'users', 'clientA', 'workoutSummaries', '2026-04-24')));
});

test('trainer cannot write client workout summary', async () => {
  const trainerDb = testEnv.authenticatedContext('trainerAssigned').firestore();
  await assertFails(
    setDoc(doc(trainerDb, 'users', 'clientA', 'workoutSummaries', '2026-04-25'), {
      date: '2026-04-25',
      eventCount: 2,
      workoutEventIds: ['evt_2'],
    })
  );
});

test('client can write own workout summary', async () => {
  const clientDb = testEnv.authenticatedContext('clientA').firestore();
  await assertSucceeds(
    setDoc(doc(clientDb, 'users', 'clientA', 'workoutSummaries', '2026-04-25'), {
      date: '2026-04-25',
      eventCount: 2,
      workoutEventIds: ['evt_2'],
    })
  );
  const snapshot = await getDoc(doc(clientDb, 'users', 'clientA', 'workoutSummaries', '2026-04-25'));
  assert.equal(snapshot.exists(), true);
});
