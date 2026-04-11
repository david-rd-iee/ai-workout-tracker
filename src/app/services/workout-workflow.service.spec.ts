import { TestBed } from '@angular/core/testing';
import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import { WorkoutChatService } from './workout-chat.service';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutSessionFormatterService } from './workout-session-formatter.service';
import { WorkoutWorkflowEstimatorPreparationService } from './workout-workflow-estimator-preparation.service';
import { WorkoutWorkflowSummaryProjectionService } from './workout-workflow-summary-projection.service';
import { WorkoutWorkflowService } from './workout-workflow.service';

describe('WorkoutWorkflowService', () => {
  let service: WorkoutWorkflowService;
  let workoutChatServiceSpy: jasmine.SpyObj<WorkoutChatService>;
  let workoutLogServiceSpy: jasmine.SpyObj<WorkoutLogService>;
  let workoutSessionFormatterSpy: jasmine.SpyObj<WorkoutSessionFormatterService>;
  let workoutWorkflowSummaryProjectionSpy: jasmine.SpyObj<WorkoutWorkflowSummaryProjectionService>;
  let workoutWorkflowEstimatorPreparationSpy: jasmine.SpyObj<WorkoutWorkflowEstimatorPreparationService>;

  const strengthRow = (exerciseType = 'bench_press'): WorkoutTrainingRow => ({
    Training_Type: 'Strength',
    estimated_calories: 42,
    exercise_type: exerciseType,
    sets: 3,
    reps: 8,
    displayed_weights_metric: '135 lb',
    weights_kg: 61.2,
  });

  const cardioRow = (): CardioTrainingRow => ({
    Training_Type: 'Cardio',
    estimated_calories: 120,
    cardio_type: 'running',
    exercise_type: 'running',
    display_distance: '3 mi',
    distance_meters: 4828,
    display_time: '24 min',
    time_minutes: 24,
  });

  const sessionWithRows = (
    rows: WorkoutTrainingRow[] = [],
    overrides: Partial<WorkoutSessionPerformance> = {}
  ): WorkoutSessionPerformance => ({
    date: '2026-04-11',
    trainingRows: rows,
    strengthTrainingRow: rows.filter((row) => row.Training_Type === 'Strength'),
    strengthTrainingRowss: rows.filter((row) => row.Training_Type === 'Strength'),
    cardioTrainingRow: [],
    otherTrainingRow: [],
    estimated_calories: rows.reduce((total, row) => total + row.estimated_calories, 0),
    trainer_notes: '',
    isComplete: false,
    sessionType: 'chat',
    notes: '',
    volume: 0,
    calories: rows.reduce((total, row) => total + row.estimated_calories, 0),
    exercises: [],
    ...overrides,
  });

  beforeEach(() => {
    workoutChatServiceSpy = jasmine.createSpyObj<WorkoutChatService>('WorkoutChatService', [
      'sendMessage',
    ]);
    workoutLogServiceSpy = jasmine.createSpyObj<WorkoutLogService>('WorkoutLogService', [
      'saveCompletedWorkout',
    ]);
    workoutSessionFormatterSpy = jasmine.createSpyObj<WorkoutSessionFormatterService>(
      'WorkoutSessionFormatterService',
      ['createEmptySession', 'normalizeSession', 'applyTrainerNotes']
    );
    workoutWorkflowSummaryProjectionSpy = jasmine.createSpyObj<WorkoutWorkflowSummaryProjectionService>(
      'WorkoutWorkflowSummaryProjectionService',
      ['projectWorkflowState', 'projectStrengthRows']
    );
    workoutWorkflowEstimatorPreparationSpy =
      jasmine.createSpyObj<WorkoutWorkflowEstimatorPreparationService>(
        'WorkoutWorkflowEstimatorPreparationService',
        ['prepareEstimatorsForSession']
      );

    workoutSessionFormatterSpy.createEmptySession.and.returnValue(sessionWithRows());
    workoutSessionFormatterSpy.normalizeSession.and.returnValue(sessionWithRows([strengthRow()]));
    workoutSessionFormatterSpy.applyTrainerNotes.and.returnValue(
      sessionWithRows([strengthRow()], {
        trainer_notes: 'Felt strong',
        notes: 'Felt strong',
        isComplete: true,
      })
    );
    workoutWorkflowSummaryProjectionSpy.projectWorkflowState.and.callFake((session) => ({
      session,
      summaryRows: {
        strengthRows: Array.isArray(session.strengthTrainingRow)
          ? session.strengthTrainingRow
          : session.strengthTrainingRow
            ? [session.strengthTrainingRow]
            : [],
        cardioRows: Array.isArray(session.cardioTrainingRow)
          ? session.cardioTrainingRow
          : session.cardioTrainingRow
            ? [session.cardioTrainingRow]
            : [],
        otherRows: (session.trainingRows ?? []).filter((row) => row.Training_Type === 'Other'),
      },
    }));
    workoutWorkflowSummaryProjectionSpy.projectStrengthRows.and.callFake((session) =>
      Array.isArray(session.strengthTrainingRow)
        ? session.strengthTrainingRow
        : session.strengthTrainingRow
          ? [session.strengthTrainingRow]
          : []
    );
    workoutWorkflowEstimatorPreparationSpy.prepareEstimatorsForSession.and.resolveTo(['bench_press']);

    TestBed.configureTestingModule({
      providers: [
        WorkoutWorkflowService,
        { provide: WorkoutChatService, useValue: workoutChatServiceSpy },
        { provide: WorkoutLogService, useValue: workoutLogServiceSpy },
        { provide: WorkoutSessionFormatterService, useValue: workoutSessionFormatterSpy },
        {
          provide: WorkoutWorkflowSummaryProjectionService,
          useValue: workoutWorkflowSummaryProjectionSpy,
        },
        {
          provide: WorkoutWorkflowEstimatorPreparationService,
          useValue: workoutWorkflowEstimatorPreparationSpy,
        },
      ],
    });

    service = TestBed.inject(WorkoutWorkflowService);
  });

  it('builds trimmed history and normalizes the chat response into workflow state', async () => {
    const previousSession = sessionWithRows([], { isComplete: true });
    const normalizedSession = sessionWithRows([strengthRow()], { isComplete: false });
    const messages = Array.from({ length: 12 }, (_, index) => ({
      from: index % 2 === 0 ? 'bot' as const : 'user' as const,
      text: `message-${index + 1}`,
    }));

    workoutChatServiceSpy.sendMessage.and.resolveTo({
      botMessage: 'Bench press added.',
      updatedSession: normalizedSession,
    });
    workoutSessionFormatterSpy.normalizeSession.and.returnValue(normalizedSession);

    const result = await service.processWorkoutMessage({
      message: 'Bench press 3x8 at 135 lb',
      messages,
      screenState: {
        session: previousSession,
        summaryRows: {
          strengthRows: [],
          cardioRows: [],
          otherRows: [],
        },
        saveStatus: 'saved',
        loggedAt: '2026-04-11T19:15:00.000Z',
        completionStatus: 'complete',
        botMessage: null,
      },
    });

    expect(workoutChatServiceSpy.sendMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({
        message: 'Bench press 3x8 at 135 lb',
        session: previousSession,
        exerciseEstimatorIds: ['bench_press'],
      })
    );
    expect(workoutChatServiceSpy.sendMessage.calls.mostRecent().args[0].history).toEqual([
      { role: 'assistant', content: 'message-3' },
      { role: 'user', content: 'message-4' },
      { role: 'assistant', content: 'message-5' },
      { role: 'user', content: 'message-6' },
      { role: 'assistant', content: 'message-7' },
      { role: 'user', content: 'message-8' },
      { role: 'assistant', content: 'message-9' },
      { role: 'user', content: 'message-10' },
      { role: 'assistant', content: 'message-11' },
      { role: 'user', content: 'message-12' },
    ]);
    expect(workoutSessionFormatterSpy.normalizeSession).toHaveBeenCalledWith(
      normalizedSession,
      jasmine.objectContaining({
        latestUserMessage: 'Bench press 3x8 at 135 lb',
      })
    );
    expect(result.botMessage).toBe('Bench press added.');
    expect(result.summaryRows.strengthRows).toEqual([strengthRow()]);
    expect(result.saveStatus).toBe('not_saved');
    expect(result.loggedAt).toBeNull();
    expect(result.completionStatus).toBe('incomplete');
  });

  it('ensures missing estimator docs for new strength rows', async () => {
    const normalizedSession = sessionWithRows([strengthRow('Front Squat')]);

    workoutChatServiceSpy.sendMessage.and.resolveTo({
      botMessage: 'Front squat added.',
      updatedSession: normalizedSession,
    });
    workoutSessionFormatterSpy.normalizeSession.and.returnValue(normalizedSession);

    await service.processWorkoutMessage({
      message: 'Front squat 3x5 at 185 lb',
      messages: [{ from: 'user', text: 'Front squat 3x5 at 185 lb' }],
      screenState: {
        session: sessionWithRows(),
        summaryRows: {
          strengthRows: [],
          cardioRows: [],
          otherRows: [],
        },
        saveStatus: 'not_saved',
        loggedAt: null,
        completionStatus: 'incomplete',
        botMessage: null,
      },
    });

    expect(workoutWorkflowEstimatorPreparationSpy.prepareEstimatorsForSession).toHaveBeenCalledWith(
      normalizedSession
    );
  });

  it('returns a cancelled submit result when trainer notes are dismissed', async () => {
    const requestTrainerNotes = jasmine
      .createSpy('requestTrainerNotes')
      .and.resolveTo(null);
    const session = sessionWithRows([strengthRow()]);

    const result = await service.submitWorkout({
      session,
      requestTrainerNotes,
    });

    expect(result.saveStatus).toBe('cancelled');
    expect(result.loggedAt).toBeNull();
    expect(result.botMessage).toBeNull();
    expect(workoutSessionFormatterSpy.applyTrainerNotes).not.toHaveBeenCalled();
    expect(workoutLogServiceSpy.saveCompletedWorkout).not.toHaveBeenCalled();
  });

  it('applies trainer notes and saves the completed workout', async () => {
    const requestTrainerNotes = jasmine
      .createSpy('requestTrainerNotes')
      .and.resolveTo('Felt strong');
    const preparedSession = sessionWithRows([strengthRow()], {
      trainer_notes: 'Felt strong',
      notes: 'Felt strong',
      isComplete: true,
    });
    const savedSession = sessionWithRows([strengthRow(), {
      Training_Type: 'Cardio',
      estimated_calories: 120,
      exercise_type: 'running',
      sets: 1,
      reps: 24,
      displayed_weights_metric: 'bodyweight',
      weights_kg: 0,
    }], {
      trainer_notes: 'Felt strong',
      notes: 'Felt strong',
      isComplete: true,
      cardioTrainingRow: [cardioRow()],
      estimated_calories: 162,
      calories: 162,
    });

    workoutSessionFormatterSpy.applyTrainerNotes.and.returnValue(preparedSession);
    workoutLogServiceSpy.saveCompletedWorkout.and.resolveTo({
      eventId: 'event-1',
      status: 'persisted',
      loggedAt: new Date('2026-04-11T19:15:00.000Z'),
      savedEvent: {
        date: '2026-04-11',
        entries: [],
        summary: {
          estimatedCalories: 162,
          trainerNotes: 'Felt strong',
          isComplete: true,
        },
        source: 'chat',
      },
      savedSession,
    });

    const result = await service.submitWorkout({
      session: sessionWithRows([strengthRow()]),
      requestTrainerNotes,
    });

    expect(workoutSessionFormatterSpy.applyTrainerNotes).toHaveBeenCalledWith(
      jasmine.objectContaining({ trainingRows: [strengthRow()] }),
      'Felt strong',
      true
    );
    expect(workoutLogServiceSpy.saveCompletedWorkout).toHaveBeenCalledWith(preparedSession);
    expect(result.saveStatus).toBe('saved');
    expect(result.session).toEqual(savedSession);
    expect(result.summaryRows.cardioRows).toEqual([cardioRow()]);
    expect(result.loggedAt).toBe('2026-04-11T19:15:00.000Z');
    expect(result.completionStatus).toBe('complete');
    expect(result.botMessage).toContain('Workout submitted and saved');
  });
});
