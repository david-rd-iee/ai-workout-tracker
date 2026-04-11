import { TestBed } from '@angular/core/testing';
import { WorkoutSessionPerformance, WorkoutTrainingRow } from '../../models/workout-session.model';
import { ExerciseEstimatorsService } from '../exercise-estimators.service';
import { WorkoutWorkflowEstimatorPreparationService } from './workout-workflow-estimator-preparation.service';
import { WorkoutWorkflowSummaryProjectionService } from './workout-workflow-summary-projection.service';

describe('WorkoutWorkflowEstimatorPreparationService', () => {
  let service: WorkoutWorkflowEstimatorPreparationService;
  let exerciseEstimatorsServiceSpy: jasmine.SpyObj<ExerciseEstimatorsService>;
  let workoutWorkflowSummaryProjectionSpy: jasmine.SpyObj<WorkoutWorkflowSummaryProjectionService>;

  const strengthRow = (exerciseType = 'bench_press'): WorkoutTrainingRow => ({
    Training_Type: 'Strength',
    estimated_calories: 42,
    exercise_type: exerciseType,
    sets: 3,
    reps: 8,
    displayed_weights_metric: '135 lb',
    weights_kg: 61.2,
  });

  const sessionWithRows = (rows: WorkoutTrainingRow[]): WorkoutSessionPerformance => ({
    date: '2026-04-11',
    trainingRows: rows,
    strengthTrainingRow: rows,
    strengthTrainingRowss: rows,
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
  });

  beforeEach(() => {
    exerciseEstimatorsServiceSpy = jasmine.createSpyObj<ExerciseEstimatorsService>(
      'ExerciseEstimatorsService',
      ['getCachedEstimatorIds', 'listEstimatorIds', 'normalizeEstimatorId']
    );
    workoutWorkflowSummaryProjectionSpy =
      jasmine.createSpyObj<WorkoutWorkflowSummaryProjectionService>(
        'WorkoutWorkflowSummaryProjectionService',
        ['projectStrengthRows']
      );

    exerciseEstimatorsServiceSpy.normalizeEstimatorId.and.callFake((rawId: string) =>
      String(rawId ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_')
    );

    TestBed.configureTestingModule({
      providers: [
        WorkoutWorkflowEstimatorPreparationService,
        { provide: ExerciseEstimatorsService, useValue: exerciseEstimatorsServiceSpy },
        {
          provide: WorkoutWorkflowSummaryProjectionService,
          useValue: workoutWorkflowSummaryProjectionSpy,
        },
      ],
    });

    service = TestBed.inject(WorkoutWorkflowEstimatorPreparationService);
  });

  it('normalizes session strength exercise ids and returns cached estimator ids without writes', async () => {
    const rows = [strengthRow('Front Squat'), strengthRow('Bench Press')];
    const session = sessionWithRows(rows);
    workoutWorkflowSummaryProjectionSpy.projectStrengthRows.and.returnValue(rows);
    exerciseEstimatorsServiceSpy.getCachedEstimatorIds.and.returnValue([
      'bench_press',
      'deadlift',
    ]);

    const result = await service.prepareEstimatorsForSession(session);

    expect(result).toEqual(['bench_press', 'deadlift']);
    expect(rows.map((row) => row.exercise_type)).toEqual(['front_squat', 'bench_press']);
    expect(exerciseEstimatorsServiceSpy.listEstimatorIds).not.toHaveBeenCalled();
  });

  it('falls back to the indexed estimator id lookup when the cache is empty', async () => {
    const rows = [strengthRow('Romanian Deadlift')];
    const session = sessionWithRows(rows);
    workoutWorkflowSummaryProjectionSpy.projectStrengthRows.and.returnValue(rows);
    exerciseEstimatorsServiceSpy.getCachedEstimatorIds.and.returnValue([]);
    exerciseEstimatorsServiceSpy.listEstimatorIds.and.resolveTo(['romanian_deadlift']);

    const result = await service.prepareEstimatorsForSession(session);

    expect(result).toEqual(['romanian_deadlift']);
    expect(rows[0].exercise_type).toBe('romanian_deadlift');
    expect(exerciseEstimatorsServiceSpy.listEstimatorIds).toHaveBeenCalledTimes(1);
  });

  it('returns an empty lookup set when the index read fails', async () => {
    const rows = [strengthRow('New Lift')];
    const session = sessionWithRows(rows);
    workoutWorkflowSummaryProjectionSpy.projectStrengthRows.and.returnValue(rows);
    exerciseEstimatorsServiceSpy.getCachedEstimatorIds.and.returnValue([]);
    exerciseEstimatorsServiceSpy.listEstimatorIds.and.rejectWith(new Error('index unavailable'));

    const result = await service.prepareEstimatorsForSession(session);

    expect(result).toEqual([]);
    expect(rows[0].exercise_type).toBe('new_lift');
  });
});
