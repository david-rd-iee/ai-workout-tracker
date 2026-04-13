import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CameraPage } from './camera.page';
import { VideoAnalysisService } from '../../services/video-analysis.service';
import { UserService } from '../../services/account/user.service';
import { AlertController, ToastController } from '@ionic/angular/standalone';

describe('CameraPage', () => {
  let component: CameraPage;
  let fixture: ComponentFixture<CameraPage>;

  const videoAnalysisServiceStub = {
    warmPoseModel: jasmine.createSpy('warmPoseModel').and.resolveTo(),
    analyzeVideo: jasmine.createSpy('analyzeVideo').and.resolveTo(null),
    saveAnalysisToTrainer: jasmine.createSpy('saveAnalysisToTrainer').and.resolveTo(null),
  };

  const userServiceStub = {
    getCurrentUser: jasmine
      .createSpy('getCurrentUser')
      .and.returnValue(signal({ uid: 'test-user', email: 'user@example.com' })),
    getUserSummaryDirectly: jasmine
      .createSpy('getUserSummaryDirectly')
      .and.resolveTo({ trainerId: '' }),
  };

  const toastControllerStub = {
    create: jasmine.createSpy('create').and.resolveTo({
      present: jasmine.createSpy('present').and.resolveTo(),
    }),
  };

  const alertControllerStub = {
    create: jasmine.createSpy('create').and.resolveTo({
      present: jasmine.createSpy('present').and.resolveTo(),
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CameraPage],
      providers: [
        { provide: VideoAnalysisService, useValue: videoAnalysisServiceStub },
        { provide: UserService, useValue: userServiceStub },
        { provide: ToastController, useValue: toastControllerStub },
        { provide: AlertController, useValue: alertControllerStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CameraPage);
    component = fixture.componentInstance;
    component.hasCameraSupport = false;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
