import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertController, NavController } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import {
  WorkoutWorkflowService,
  WorkoutChatScreenState,
} from '../../services/workout-workflow/workout-workflow.service';
import { UserService } from '../../services/account/user.service';
import { WorkoutChatbotPage } from './workout-chatbot.page';
import { WorkoutSessionPerformance, WorkoutTrainingRow } from '../../models/workout-session.model';

describe('WorkoutChatbotPage', () => {
  let component: WorkoutChatbotPage;
  let fixture: ComponentFixture<WorkoutChatbotPage>;

  const createSession = (
    trainingRows: WorkoutTrainingRow[] = []
  ): WorkoutSessionPerformance => ({
    date: '2026-04-11',
    trainingRows,
    strengthTrainingRow: trainingRows.filter((row) => row.Training_Type === 'Strength'),
    strengthTrainingRowss: trainingRows.filter((row) => row.Training_Type === 'Strength'),
    cardioTrainingRow: [],
    otherTrainingRow: [],
    estimated_calories: trainingRows.reduce((total, row) => total + row.estimated_calories, 0),
    trainer_notes: '',
    isComplete: false,
    sessionType: 'chat',
    notes: '',
    volume: 0,
    calories: trainingRows.reduce((total, row) => total + row.estimated_calories, 0),
    exercises: [],
  });

  const createWorkflowState = (
    trainingRows: WorkoutTrainingRow[] = []
  ): WorkoutChatScreenState => ({
    session: createSession(trainingRows),
    summaryRows: {
      strengthRows: trainingRows.filter((row) => row.Training_Type === 'Strength'),
      cardioRows: [],
      otherRows: trainingRows.filter((row) => row.Training_Type === 'Other'),
    },
    saveStatus: 'not_saved',
    loggedAt: null,
    completionStatus: 'incomplete',
    botMessage: null,
  });

  const initialState = createWorkflowState();
  const updatedRow: WorkoutTrainingRow = {
    Training_Type: 'Strength',
    estimated_calories: 42,
    exercise_type: 'bench_press',
    sets: 3,
    reps: 8,
    displayed_weights_metric: '135 lb',
    weights_kg: 61.2,
  };
  const updatedState = createWorkflowState([updatedRow]);
  const savedAt = new Date('2026-04-11T19:15:00.000Z');

  const workoutWorkflowServiceStub = {
    createInitialState: jasmine.createSpy('createInitialState').and.callFake(() => createWorkflowState()),
    processWorkoutMessage: jasmine.createSpy('processWorkoutMessage').and.resolveTo({
      ...updatedState,
      botMessage: 'Bench press added.',
    }),
    submitWorkout: jasmine.createSpy('submitWorkout').and.resolveTo({
      ...updatedState,
      eventId: 'event-1',
      saveStatus: 'saved' as const,
      loggedAt: savedAt.toISOString(),
      completionStatus: 'complete' as const,
      botMessage:
        'Workout submitted and saved to your history. Score updates should now be available, and summaries will finish updating in the background.',
      savePersistenceStatus: 'persisted' as const,
    }),
  };

  const platformStub = {
    is: jasmine.createSpy('is').and.returnValue(false),
    backButton: {
      subscribeWithPriority: jasmine.createSpy('subscribeWithPriority'),
    },
  };

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
    await TestBed.configureTestingModule({
      imports: [WorkoutChatbotPage],
      providers: [
        provideRouter([]),
        { provide: WorkoutWorkflowService, useValue: workoutWorkflowServiceStub },
        { provide: Platform, useValue: platformStub },
        { provide: AlertController, useValue: alertControllerStub },
        { provide: NavController, useValue: navControllerStub },
        { provide: UserService, useValue: userServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkoutChatbotPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  beforeEach(() => {
    workoutWorkflowServiceStub.createInitialState.calls.reset();
    workoutWorkflowServiceStub.createInitialState.and.callFake(() => createWorkflowState());
    workoutWorkflowServiceStub.processWorkoutMessage.calls.reset();
    workoutWorkflowServiceStub.processWorkoutMessage.and.resolveTo({
      ...updatedState,
      botMessage: 'Bench press added.',
    });
    workoutWorkflowServiceStub.submitWorkout.calls.reset();
    workoutWorkflowServiceStub.submitWorkout.and.resolveTo({
      ...updatedState,
      eventId: 'event-1',
      saveStatus: 'saved' as const,
      loggedAt: savedAt.toISOString(),
      completionStatus: 'complete' as const,
      botMessage:
        'Workout submitted and saved to your history. Score updates should now be available, and summaries will finish updating in the background.',
      savePersistenceStatus: 'persisted' as const,
    });
    platformStub.is.calls.reset();
    platformStub.is.and.returnValue(false);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('delegates message handling to the workflow service', async () => {
    component.userInput = 'Bench 3x8 at 135';

    await component.handleSend();

    expect(workoutWorkflowServiceStub.processWorkoutMessage).toHaveBeenCalledWith({
      message: 'Bench 3x8 at 135',
      messages: jasmine.arrayContaining([{ from: 'user', text: 'Bench 3x8 at 135' }]),
      screenState: jasmine.objectContaining({
        session: jasmine.objectContaining({ date: '2026-04-11' }),
        saveStatus: 'not_saved',
        loggedAt: null,
      }),
    });
    expect(component.displayStrengthRows).toEqual([updatedRow]);
    expect(component.messages[component.messages.length - 1]).toEqual({
      from: 'bot',
      text: 'Bench press added.',
    });
  });

  it('delegates workout submission to the workflow service', async () => {
    component.session = updatedState.session;
    component.displayStrengthRows = updatedState.summaryRows.strengthRows;
    component.displayCardioRows = updatedState.summaryRows.cardioRows;
    component.displayOtherRows = updatedState.summaryRows.otherRows;

    await component.submitWorkout();

    expect(workoutWorkflowServiceStub.submitWorkout).toHaveBeenCalled();
    expect(component.hasSavedWorkout).toBeTrue();
    expect(component.savedWorkoutLoggedAt).toBe(savedAt.toISOString());
  });
});
