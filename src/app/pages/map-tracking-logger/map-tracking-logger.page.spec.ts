import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { AlertController, NavController } from '@ionic/angular/standalone';
import { UserService } from '../../services/account/user.service';
import { CardioTrainingRow, WorkoutSessionPerformance } from '../../models/workout-session.model';
import { WorkoutWorkflowService } from '../../services/workout-workflow.service';
import { WorkoutSessionFormatterService } from '../../services/workout-session-formatter.service';
import { MapTrackingLoggerPage } from './map-tracking-logger.page';

describe('MapTrackingLoggerPage', () => {
  let component: MapTrackingLoggerPage;
  let fixture: ComponentFixture<MapTrackingLoggerPage>;
  let router: Router;

  const cardioRow = (): CardioTrainingRow => ({
    Training_Type: 'Cardio',
    estimated_calories: 320,
    cardio_type: 'running',
    exercise_type: 'running',
    display_distance: '4.2 mi',
    distance_meters: 6759,
    display_time: '38 min',
    time_minutes: 38,
    activity_source: 'map_tracking',
  });

  const createSession = (): WorkoutSessionPerformance => ({
    date: '2026-04-11',
    trainingRows: [
      {
        Training_Type: 'Cardio',
        estimated_calories: 320,
        exercise_type: 'running',
        sets: 1,
        reps: 38,
        displayed_weights_metric: 'bodyweight',
        weights_kg: 0,
      },
    ],
    strengthTrainingRow: [],
    strengthTrainingRowss: [],
    cardioTrainingRow: [cardioRow()],
    otherTrainingRow: [],
    estimated_calories: 320,
    trainer_notes: '',
    isComplete: false,
    sessionType: 'map_tracking',
    notes: '',
    volume: 0,
    calories: 320,
    exercises: [],
  });

  const savedAt = new Date('2026-04-11T19:30:00.000Z');
  const trackedSession = createSession();
  const savedSession = { ...createSession(), isComplete: true };

  const workoutWorkflowServiceStub = {
    submitWorkout: jasmine.createSpy('submitWorkout').and.resolveTo({
      status: 'saved' as const,
      session: savedSession,
      summaryRows: {
        strengthRows: [],
        cardioRows: [cardioRow()],
        otherRows: [],
      },
      eventId: 'event-2',
      saveStatus: 'persisted' as const,
      hasSavedWorkout: true as const,
      savedWorkoutLoggedAt: savedAt.toISOString(),
    }),
  };
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
  const authStub = {
    currentUser: null,
  };
  const firestoreStub = {};

  beforeEach(async () => {
    workoutSessionFormatterStub.createEmptySession.and.returnValue(createSession());

    await TestBed.configureTestingModule({
      imports: [MapTrackingLoggerPage],
      providers: [
        provideRouter([]),
        { provide: WorkoutWorkflowService, useValue: workoutWorkflowServiceStub },
        { provide: WorkoutSessionFormatterService, useValue: workoutSessionFormatterStub },
        { provide: AlertController, useValue: alertControllerStub },
        { provide: NavController, useValue: navControllerStub },
        { provide: UserService, useValue: userServiceStub },
        { provide: Auth, useValue: authStub },
        { provide: Firestore, useValue: firestoreStub },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);

    fixture = TestBed.createComponent(MapTrackingLoggerPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  beforeEach(() => {
    workoutWorkflowServiceStub.submitWorkout.calls.reset();
    workoutWorkflowServiceStub.submitWorkout.and.resolveTo({
      status: 'saved' as const,
      session: savedSession,
      summaryRows: {
        strengthRows: [],
        cardioRows: [cardioRow()],
        otherRows: [],
      },
      eventId: 'event-2',
      saveStatus: 'persisted' as const,
      hasSavedWorkout: true as const,
      savedWorkoutLoggedAt: savedAt.toISOString(),
    });
    (router.navigate as jasmine.Spy).calls.reset();
  });

  it('delegates tracked workout submission to the workflow service', async () => {
    component.session = trackedSession;
    component.trackingState = 'finished';
    component.distanceMeters = 6759;
    component.startedAt = new Date('2026-04-11T18:50:00.000Z');
    component.endedAt = new Date('2026-04-11T19:28:00.000Z');

    await component.logWorkout();

    expect(workoutWorkflowServiceStub.submitWorkout).toHaveBeenCalledWith({
      session: trackedSession,
      requestTrainerNotes: jasmine.any(Function),
    });
    expect(component.session).toBe(savedSession);
    expect(router.navigate).toHaveBeenCalledWith(['/workout-summary'], {
      state: {
        summary: savedSession,
        loggedAt: savedAt.toISOString(),
        backHref: '/map-tracking-logger',
      },
    });
  });

  it('does not navigate when the workflow service cancels submission', async () => {
    component.session = trackedSession;
    component.trackingState = 'finished';
    component.distanceMeters = 6759;
    component.startedAt = new Date('2026-04-11T18:50:00.000Z');
    component.endedAt = new Date('2026-04-11T19:28:00.000Z');
    workoutWorkflowServiceStub.submitWorkout.and.resolveTo({
      status: 'cancelled' as const,
      session: trackedSession,
      summaryRows: {
        strengthRows: [],
        cardioRows: [cardioRow()],
        otherRows: [],
      },
      hasSavedWorkout: false,
      savedWorkoutLoggedAt: null,
    });

    await component.logWorkout();

    expect(workoutWorkflowServiceStub.submitWorkout).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
