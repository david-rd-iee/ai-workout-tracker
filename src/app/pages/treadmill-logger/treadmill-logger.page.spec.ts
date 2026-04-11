import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertController, NavController } from '@ionic/angular/standalone';
import { UserService } from '../../services/account/user.service';
import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import { ExerciseEstimatorsService } from '../../services/exercise-estimators.service';
import { WorkoutChatService } from '../../services/workout-chat.service';
import { WorkoutWorkflowService } from '../../services/workout-workflow.service';
import { WorkoutSessionFormatterService } from '../../services/workout-session-formatter.service';
import { TreadmillLoggerPage } from './treadmill-logger.page';

describe('TreadmillLoggerPage', () => {
  let component: TreadmillLoggerPage;
  let fixture: ComponentFixture<TreadmillLoggerPage>;
  let router: Router;

  const cardioRow = (): CardioTrainingRow => ({
    Training_Type: 'Cardio',
    estimated_calories: 210,
    cardio_type: 'running',
    exercise_type: 'running',
    display_distance: '3.0 mi',
    distance_meters: 4828,
    display_time: '28 min',
    time_minutes: 28,
  });

  const sessionFromCardioRows = (
    cardioRows: CardioTrainingRow[] = []
  ): WorkoutSessionPerformance => {
    const trainingRows: WorkoutTrainingRow[] = cardioRows.map((row) => ({
      Training_Type: 'Cardio',
      estimated_calories: row.estimated_calories,
      exercise_type: row.cardio_type,
      sets: 1,
      reps: Math.floor(Number(row.time_minutes ?? 0)),
      displayed_weights_metric: 'bodyweight',
      weights_kg: 0,
    }));

    const estimatedCalories = cardioRows.reduce(
      (total, row) => total + Number(row.estimated_calories ?? 0),
      0
    );

    return {
      date: '2026-04-11',
      trainingRows,
      strengthTrainingRow: [],
      strengthTrainingRowss: [],
      cardioTrainingRow: cardioRows,
      otherTrainingRow: [],
      estimated_calories: estimatedCalories,
      trainer_notes: '',
      isComplete: false,
      sessionType: 'treadmill_logger',
      notes: '',
      volume: 0,
      calories: estimatedCalories,
      exercises: [],
    };
  };

  const savedAt = new Date('2026-04-11T19:15:00.000Z');
  const analyzedSession = sessionFromCardioRows([cardioRow()]);
  const savedSession = sessionFromCardioRows([cardioRow()]);
  savedSession.isComplete = true;

  const workoutWorkflowServiceStub = {
    submitWorkout: jasmine.createSpy('submitWorkout').and.resolveTo({
      session: savedSession,
      summaryRows: {
        strengthRows: [],
        cardioRows: [cardioRow()],
        otherRows: [],
      },
      eventId: 'event-1',
      saveStatus: 'saved' as const,
      loggedAt: savedAt.toISOString(),
      completionStatus: 'complete' as const,
      botMessage: null,
      savePersistenceStatus: 'persisted' as const,
    }),
  };

  const workoutChatServiceStub = jasmine.createSpyObj<WorkoutChatService>('WorkoutChatService', [
    'analyzeTreadmillImage',
  ]);
  const exerciseEstimatorsServiceStub = jasmine.createSpyObj<ExerciseEstimatorsService>(
    'ExerciseEstimatorsService',
    ['normalizeEstimatorId']
  );
  const workoutSessionFormatterStub = jasmine.createSpyObj<WorkoutSessionFormatterService>(
    'WorkoutSessionFormatterService',
    ['createEmptySession', 'normalizeSession']
  );
  const alertControllerStub = {
    create: jasmine.createSpy('create').and.resolveTo({
      present: jasmine.createSpy('present').and.resolveTo(),
    }),
  };
  const navControllerStub = {
    navigateBack: jasmine.createSpy('navigateBack'),
    navigateForward: jasmine.createSpy('navigateForward'),
    back: jasmine.createSpy('back'),
  };
  const userServiceStub = {
    getUserInfo: jasmine.createSpy('getUserInfo').and.returnValue(() => null),
  };

  beforeEach(async () => {
    workoutSessionFormatterStub.createEmptySession.and.returnValue(sessionFromCardioRows());
    exerciseEstimatorsServiceStub.normalizeEstimatorId.and.callFake((value: string) => value);

    await TestBed.configureTestingModule({
      imports: [TreadmillLoggerPage],
      providers: [
        provideRouter([]),
        { provide: WorkoutWorkflowService, useValue: workoutWorkflowServiceStub },
        { provide: WorkoutChatService, useValue: workoutChatServiceStub },
        { provide: ExerciseEstimatorsService, useValue: exerciseEstimatorsServiceStub },
        { provide: WorkoutSessionFormatterService, useValue: workoutSessionFormatterStub },
        { provide: AlertController, useValue: alertControllerStub },
        { provide: NavController, useValue: navControllerStub },
        { provide: UserService, useValue: userServiceStub },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);

    fixture = TestBed.createComponent(TreadmillLoggerPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  beforeEach(() => {
    workoutWorkflowServiceStub.submitWorkout.calls.reset();
    workoutWorkflowServiceStub.submitWorkout.and.resolveTo({
      session: savedSession,
      summaryRows: {
        strengthRows: [],
        cardioRows: [cardioRow()],
        otherRows: [],
      },
      eventId: 'event-1',
      saveStatus: 'saved' as const,
      loggedAt: savedAt.toISOString(),
      completionStatus: 'complete' as const,
      botMessage: null,
      savePersistenceStatus: 'persisted' as const,
    });
    (router.navigate as jasmine.Spy).calls.reset();
  });

  it('delegates treadmill workout submission to the workflow service', async () => {
    component.session = analyzedSession;

    await component.logWorkout();

    expect(workoutWorkflowServiceStub.submitWorkout).toHaveBeenCalledWith({
      session: analyzedSession,
      requestTrainerNotes: jasmine.any(Function),
    });
    expect(component.session).toBe(savedSession);
    expect(router.navigate).toHaveBeenCalledWith(['/workout-summary'], {
      state: {
        summary: savedSession,
        loggedAt: savedAt.toISOString(),
        backHref: '/treadmill-logger',
      },
    });
  });

  it('does not navigate when the workflow service cancels submission', async () => {
    component.session = analyzedSession;
    workoutWorkflowServiceStub.submitWorkout.and.resolveTo({
      session: analyzedSession,
      summaryRows: {
        strengthRows: [],
        cardioRows: [cardioRow()],
        otherRows: [],
      },
      eventId: '',
      saveStatus: 'cancelled' as const,
      loggedAt: null,
      completionStatus: 'incomplete' as const,
      botMessage: null,
      savePersistenceStatus: null,
    });

    await component.logWorkout();

    expect(workoutWorkflowServiceStub.submitWorkout).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
