# Architecture Diagrams

This document gives you:

1. A readable UML class/object view of the main runtime objects in the repo.
2. A sequence diagram for the active workout logging flow.
3. A full exported-object inventory grouped by source area so the visual diagram can stay readable.

## Scope note

This codebase has dozens of pages and components. A literal single-canvas diagram of every exported object would be too dense to use, so the UML below groups the object graph by subsystem and highlights the objects that actively collaborate at runtime.

Important architectural note discovered during generation:

- The active frontend workout submit flow calls the backend-owned `completeWorkoutEvent` command.
- `completeWorkoutEvent` persists the canonical workout event to `users/{uid}/workoutEvents/{eventId}` and returns success as soon as that write completes.
- The `onWorkoutEventCreated` event processor layer derives user stats, score aggregates, trainer summaries, trainer chat summaries, and estimator workout logs asynchronously from `users/{uid}/workoutEvents/{eventId}`.
- The workout history page now reads canonical `users/{uid}/workoutEvents/{eventId}` records directly.
- The legacy `workoutSessions/{sessionId}` trigger has been retired so non-authoritative paths are no longer watched.
- The authoritative workout domain contract now lives in `shared/models/workout-event.model.ts`.
- See `docs/workout-event-model.md` for the canonical workout shape and legacy adapter mapping.

## UML Class Diagram

```mermaid
classDiagram
direction LR

namespace Frontend_Pages {
  class WorkoutChatbotPage
  class WorkoutSummaryPage
  class GroupsPage
  class LeaderboardPage
  class ChatDetailPage
  class ClientFindTrainerPage
  class TrainerCalendarPage
  class ProfileSettingsPage
}

namespace Frontend_Services {
  class WorkoutWorkflowService
  class WorkoutWorkflowSummaryProjectionService
  class WorkoutWorkflowEstimatorPreparationService
  class WorkoutChatService
  class WorkoutLogService
  class WorkoutSessionFormatterService
  class ExerciseEstimatorsService
  class GroupService
  class LeaderboardService
  class ChatsService
  class NotificationService
  class UserBadgesService
  class GreekStatuesService
  class UserStatsService
  class AccountService
  class ProfileRepositoryService
  class TrainerFinderService
  class TrainerAvailabilityService
  class BookingService
  class SessionNotesService
  class VideoAnalysisService
  class AccountUserService
  class LegacyUserService
}

namespace Backend_Functions {
  class CompleteWorkoutEventCallable
  class WorkoutEventPostWriteHandlers
}

namespace Authoritative_Workout_Domain {
  class WorkoutEvent {
    +date: string
    +entries: WorkoutEventEntry[]
    +summary: WorkoutEventSummary
    +source: WorkoutEventSource
  }

  class WorkoutEventSummary {
    +estimatedCalories: number
    +trainerNotes: string
    +isComplete: boolean
  }

  class WorkoutEventEntry {
    +kind: strength/cardio/other
    +estimatedCalories: number
  }

  class WorkoutEventRecord {
    +schemaVersion: 1
    +event: WorkoutEvent
    +submissionMetadata: localSubmittedDate + localSubmittedHour
    +createdAt: timestamp
    +updatedAt: timestamp
  }
}

namespace Legacy_Adapter_View_Models {
  class WorkoutSessionPerformance {
    +role: adapter/view-model
    +date: string
    +trainingRows: WorkoutTrainingRow[]
    +strengthTrainingRow: WorkoutTrainingRow[]
    +cardioTrainingRow: CardioTrainingRow[]
    +otherTrainingRow: OtherTrainingRow[]
    +estimated_calories: number
    +trainer_notes: string
    +isComplete: boolean
  }

  class WorkoutTrainingRow {
    +Training_Type: TrainingType
    +exercise_type: string
    +sets: number
    +reps: number
    +displayed_weights_metric: string
    +weights_kg: number
    +estimated_calories: number
  }

  class CardioTrainingRow {
    +Training_Type: Cardio
    +cardio_type: string
    +display_distance: string
    +display_time: string
    +distance_meters: number
    +time_minutes: number
    +estimated_calories: number
  }

  class OtherTrainingRow {
    +Training_Type: Other
    +estimated_calories: number
  }
}

namespace Domain_Models {
  class UserStats {
    +userId: string
    +userScore: UserScore
    +Expected_Effort: ExpectedEffortMap
    +streakData: StreakData
    +groupRankings: GroupRankingsMap
    +region: Region
  }

  class UserScore {
    +cardioScore: CardioScoreMap
    +strengthScore: StrengthScoreMap
    +totalScore: number
    +maxAddedScoreWithinDay: number
  }

  class AppUser {
    +userId: string
    +email: string
    +firstName: string
    +lastName: string
    +groupID: string[]
    +trainerId: string
    +isPT: boolean
  }

  class Group {
    +groupId: string
    +name: string
    +ownerUserId: string
    +userIDs: string[]
    +isPTGroup: boolean
  }

  class Chat {
    +chatId: string
    +participants: string[]
    +lastMessage: string
    +lastMessageTime: string
    +messages: message map
  }

  class Message {
    +senderId: string
    +text: string
    +timestamp: string
    +read: boolean
  }

  class ExerciseEstimatorDoc {
    +id: string
    +model: ExerciseEstimatorModel
    +coefficients: ExerciseEstimatorCoefficientMap
  }

  class GreekStatueDefinition {
    +id: string
    +title: string
    +category: StatueCategory
    +tiers: tier map
  }

  class UserBadgeStatDoc {
    +currentLevel: UserBadgeLevel
    +currentValue: number
    +nextTierValue: number
    +progressToNext: number
    +isDisplayed: boolean
  }
}

namespace Backend_Functions {
  class WorkoutChatCallable
  class TreadmillLoggerCallable
  class RetrainExerciseEstimatorOnWorkoutLogCreate
  class OnBookingChange
  class OnTrainerClientChange
}

namespace Infrastructure {
  class Firestore
  class RealtimeDatabase
  class OpenAI
}

WorkoutEvent o-- WorkoutEventSummary
WorkoutEvent o-- WorkoutEventEntry
WorkoutEventRecord o-- WorkoutEvent
WorkoutSessionPerformance o-- WorkoutTrainingRow
WorkoutSessionPerformance o-- CardioTrainingRow
WorkoutSessionPerformance o-- OtherTrainingRow
UserStats o-- UserScore
Chat o-- Message

WorkoutChatbotPage --> WorkoutWorkflowService : processWorkoutMessage()/submitWorkout()
WorkoutWorkflowService --> WorkoutChatService : sendMessage()
WorkoutWorkflowService --> WorkoutLogService : saveCompletedWorkout()
WorkoutWorkflowService --> WorkoutWorkflowSummaryProjectionService : project workflow/session rows
WorkoutWorkflowService --> WorkoutWorkflowEstimatorPreparationService : prepare estimator docs
WorkoutWorkflowService --> WorkoutSessionFormatterService : normalize/apply session state
WorkoutWorkflowEstimatorPreparationService --> ExerciseEstimatorsService : ensureEstimatorDocExists()/listEstimatorIds()
WorkoutWorkflowSummaryProjectionService --> WorkoutSessionPerformance : project summary rows
WorkoutSummaryPage --> WorkoutSessionPerformance

GroupsPage --> GroupService
LeaderboardPage --> LeaderboardService
ChatDetailPage --> ChatsService
ClientFindTrainerPage --> TrainerFinderService
TrainerCalendarPage --> TrainerAvailabilityService
TrainerCalendarPage --> BookingService
ProfileSettingsPage --> AccountService
ProfileSettingsPage --> AccountUserService

AccountService --> GroupService
AccountService --> Firestore
AccountUserService --> AccountService
AccountUserService --> ProfileRepositoryService
AccountUserService --> UserBadgesService
AccountUserService --> UserStatsService
LegacyUserService --> Firestore
ProfileRepositoryService --> Firestore
ProfileRepositoryService --> AppUser

GroupService --> ProfileRepositoryService
GroupService --> Group
LeaderboardService --> AccountUserService
LeaderboardService --> ProfileRepositoryService
LeaderboardService --> UserStats

WorkoutLogService --> WorkoutSessionPerformance
WorkoutLogService ..> WorkoutEvent : canonical submit payload
WorkoutLogService --> CompleteWorkoutEventCallable
WorkoutSessionPerformance ..> WorkoutEvent : adapts to/from

WorkoutSessionFormatterService --> ExerciseEstimatorsService
ExerciseEstimatorsService --> ExerciseEstimatorDoc
ExerciseEstimatorsService --> Firestore
CompleteWorkoutEventCallable --> WorkoutEventRecord
CompleteWorkoutEventCallable --> Firestore
WorkoutEventPostWriteHandlers --> WorkoutEventRecord
WorkoutEventPostWriteHandlers ..> WorkoutEvent : derive outputs from
Firestore --> WorkoutEventPostWriteHandlers : on workoutEvents create
WorkoutEventPostWriteHandlers --> UserStats
WorkoutEventPostWriteHandlers --> ExerciseEstimatorDoc
WorkoutEventPostWriteHandlers --> Firestore
WorkoutEventPostWriteHandlers --> RealtimeDatabase

ChatsService --> RealtimeDatabase
ChatsService --> AccountUserService
ChatsService --> NotificationService
ChatsService --> Chat

UserBadgesService --> GreekStatuesService
UserBadgesService --> UserBadgeStatDoc
UserBadgesService --> Firestore
GreekStatuesService --> GreekStatueDefinition
GreekStatuesService --> Firestore
UserStatsService --> UserStats
UserStatsService --> Firestore
SessionNotesService --> Firestore
VideoAnalysisService --> WorkoutSessionPerformance

WorkoutChatService --> WorkoutChatCallable
WorkoutChatService --> TreadmillLoggerCallable

WorkoutChatCallable --> OpenAI
TreadmillLoggerCallable --> OpenAI

RetrainExerciseEstimatorOnWorkoutLogCreate --> Firestore
OnBookingChange --> Firestore
OnTrainerClientChange --> Firestore
```

## Sequence Diagram

This sequence reflects the active workout-chat-to-save flow implemented in the current app.

```mermaid
sequenceDiagram
autonumber

actor User
participant Page as WorkoutChatbotPage
participant WorkflowSvc as WorkoutWorkflowService
participant SummaryProjection as WorkoutWorkflowSummaryProjectionService
participant EstimatorPrep as WorkoutWorkflowEstimatorPreparationService
participant ChatSvc as WorkoutChatService
participant ChatFn as workoutChatCallable
participant OpenAI
participant EstSvc as ExerciseEstimatorsService
participant LogSvc as WorkoutLogService
participant CompleteWorkoutCmd as completeWorkoutEvent
participant FS as Firestore
participant EventProcessor as onWorkoutEventCreated
participant RTDB as Realtime Database
participant RetrainFn as retrainExerciseEstimatorOnWorkoutLogCreate

User->>Page: Enter workout message
Page->>WorkflowSvc: processWorkoutMessage(message, messages, session, hasSavedWorkout, savedWorkoutLoggedAt)
WorkflowSvc->>ChatSvc: sendMessage(message, session, history, estimatorIds)
ChatSvc->>ChatFn: httpsCallable(payload)
ChatFn->>OpenAI: Parse/update workout JSON
OpenAI-->>ChatFn: assistantMessage + summary
ChatFn-->>ChatSvc: ChatResponse
ChatSvc-->>WorkflowSvc: botMessage + updatedSession
WorkflowSvc->>SummaryProjection: projectStrengthRows(updatedSession)
SummaryProjection-->>WorkflowSvc: strengthRows
WorkflowSvc->>EstimatorPrep: ensureEstimatorDocsForRows(strengthRows)
EstimatorPrep->>EstSvc: ensure estimator docs for strength rows
EstSvc->>FS: Read/create exercise estimator docs
WorkflowSvc->>SummaryProjection: projectWorkflowState(updatedSession)
SummaryProjection-->>WorkflowSvc: {session, summaryRows}
WorkflowSvc-->>Page: { session, summaryRows, hasSavedWorkout, savedWorkoutLoggedAt, botMessage }

User->>Page: Submit workout
Page->>WorkflowSvc: submitWorkout(session, requestTrainerNotes)
WorkflowSvc->>Page: request trainer notes
Page-->>WorkflowSvc: trainer notes or cancel
WorkflowSvc->>LogSvc: saveCompletedWorkout(session)
LogSvc->>CompleteWorkoutCmd: completeWorkoutEvent(normalized WorkoutEvent)
CompleteWorkoutCmd->>FS: Write users/{uid}/workoutEvents/{eventId}
CompleteWorkoutCmd-->>LogSvc: {eventId, status: persisted}
LogSvc-->>WorkflowSvc: savedSession + persisted status
WorkflowSvc->>SummaryProjection: projectWorkflowState(savedSession)
SummaryProjection-->>WorkflowSvc: {session, summaryRows}
WorkflowSvc-->>Page: { status, session, summaryRows, hasSavedWorkout, savedWorkoutLoggedAt }
Page-->>User: Success message + workout summary

FS-->>EventProcessor: Trigger on users/{uid}/workoutEvents/{eventId}
EventProcessor->>FS: Update streak + early-morning stats
EventProcessor->>FS: Write score totals, addedScore, rankings, estimator workout_logs
EventProcessor->>FS: Create trainer summary
EventProcessor->>RTDB: Send trainer chat summary

FS-->>RetrainFn: Trigger when estimator workout_logs doc is created
RetrainFn->>FS: Retrain and persist estimator coefficients/metrics

Note over LogSvc,EventProcessor: Submit success ends when completeWorkoutEvent returns after persisting users/{uid}/workoutEvents/{eventId}; onWorkoutEventCreated then runs the current processors sequentially
```

## Exported Object Inventory

The lists below map exported objects back to their source areas. This is the full index used to derive the grouped UML.

### Frontend services

- `src/app/services/account/account.service.ts`: `AccountService`
- `src/app/services/account/profile-repository.service.ts`: `ProfileRepositoryService`
- `src/app/services/account/user.service.ts`: `UserService`
- `src/app/services/app-version.ts`: `AppVersionService`
- `src/app/services/attachment.service.ts`: `AttachmentService`
- `src/app/services/auth.service.ts`: `AuthService`
- `src/app/services/booking.service.ts`: `BookingService`
- `src/app/services/chats.service.ts`: `ChatsService`
- `src/app/services/deep-link.service.ts`: `DeepLinkService`
- `src/app/services/exercise-estimators.service.ts`: `ExerciseEstimatorsService`
- `src/app/services/file-upload.service.ts`: `FileUploadService`
- `src/app/services/google-analytics.service.ts`: `GoogleAnalyticsService`
- `src/app/services/greek-statues.service.ts`: `GreekStatuesService`
- `src/app/services/group.service.ts`: `GroupService`
- `src/app/services/image-picker.service.ts`: `ImagePickerService`
- `src/app/services/leaderboard.service.ts`: `LeaderboardService`
- `src/app/services/notes.service.ts`: `NotesService`
- `src/app/services/notification.service.ts`: `NotificationService`
- `src/app/services/session-booking.service.ts`: `SessionBookingService`
- `src/app/services/agreement.service.ts`: `SessionBookingService`
- `src/app/services/session-notes.service.ts`: `SessionNotesService`
- `src/app/services/trainer-availability.service.ts`: `TrainerAvailabilityService`
- `src/app/services/trainer-finder.service.ts`: `TrainerFinderService`
- `src/app/services/update-score.service.ts`: `UpdateScoreService`
- `src/app/services/user-badges.service.ts`: `UserBadgesService`
- `src/app/services/user-stats.service.ts`: `UserStatsService`
- `src/app/services/user.service.ts`: `UserService`
- `src/app/services/video-analysis.service.ts`: `VideoAnalysisService`
- `src/app/services/workout-chat.service.ts`: `WorkoutChatService`
- `src/app/services/workout-log.service.ts`: `WorkoutLogService`
- `src/app/services/workout-workflow.service.ts`: `WorkoutWorkflowService`
- `src/app/services/workout-workflow-estimator-preparation.service.ts`: `WorkoutWorkflowEstimatorPreparationService`
- `src/app/services/workout-workflow-summary-projection.service.ts`: `WorkoutWorkflowSummaryProjectionService`
- `src/app/services/workout-session-formatter.service.ts`: `WorkoutSessionFormatterService`

### Frontend pages

- `src/app/pages/account/trainer-account/trainer-account.page.ts`: `AccountPage`
- `src/app/pages/account/client-account/client-account.page.ts`: `ClientAccountPage`
- `src/app/pages/calender/calendar.page.ts`: `CalendarPage`
- `src/app/pages/calender/client-calendar/client-calendar.page.ts`: `ClientCalendarPage`
- `src/app/pages/calender/trainer-calendar/trainer-calendar.page.ts`: `TrainerCalendarPage`
- `src/app/pages/camera/camera.page.ts`: `CameraPage`
- `src/app/pages/chats/chats.page.ts`: `ChatsPage`
- `src/app/pages/chats/chat-detail/chat-detail.page.ts`: `ChatDetailPage`
- `src/app/pages/chats/client-chats/client-chats.page.ts`: `ClientChatsPage`
- `src/app/pages/client-details/client-details.page.ts`: `ClientDetailsPage`
- `src/app/pages/client-find-trainer/client-find-trainer.page.ts`: `ClientFindTrainerPage`
- `src/app/pages/complete-profile/complete-profile.page.ts`: `CompleteProfilePage`
- `src/app/pages/delete-account/delete-account.page.ts`: `DeleteAccountPage`
- `src/app/pages/group-settings/group-settings.page.ts`: `GroupSettingsPage`
- `src/app/pages/groups/groups.page.ts`: `GroupsPage`
- `src/app/pages/home/home.page.ts`: `HomePage`
- `src/app/pages/leaderboards/leaderboard/leaderboard.page.ts`: `LeaderboardPage`
- `src/app/pages/leaderboards/regional-leaderboard/regional-leaderboard.page.ts`: `RegionalLeaderboardPage`
- `src/app/pages/live-session/live-session.page.ts`: `LiveSessionPage`
- `src/app/pages/logging-method-routes/logging-method-routes.page.ts`: `LoggingMethodRoutesPage`
- `src/app/pages/login/login.page.ts`: `LoginPage`
- `src/app/pages/map-tracking-logger/map-tracking-logger.page.ts`: `MapTrackingLoggerPage`
- `src/app/pages/profile-creation/profile-creation.page.ts`: `ProfileCreationPage`
- `src/app/pages/profile-creation/profile-create-client/profile-create-client.page.ts`: `ProfileCreateClientPage`
- `src/app/pages/profile-creation/profile-create-trainer/profile-create-trainer.page.ts`: `ProfileCreateTrainerPage`
- `src/app/pages/profile-settings/profile-settings.page.ts`: `ProfileSettingsPage`
- `src/app/pages/profile-user/profile-user.page.ts`: `ProfileUserPage`
- `src/app/pages/profiles/client-profile/client-profile.page.ts`: `ClientProfilePage`
- `src/app/pages/sign-up/sign-up.page.ts`: `SignUpPage`
- `src/app/pages/statues-dashbord/statues-dashbord.page.ts`: `StatuesDashbordPage`
- `src/app/pages/tabs/tabs.page.ts`: `TabsPage`
- `src/app/pages/treadmill-logger/treadmill-logger.page.ts`: `TreadmillLoggerPage`
- `src/app/pages/workout-chatbot/workout-chatbot.page.ts`: `WorkoutChatbotPage`
- `src/app/pages/workout-details/workout-details.page.ts`: `WorkoutDetailsPage`
- `src/app/pages/workout-history/workout-history.page.ts`: `WorkoutHistoryPage`
- `src/app/pages/workout-history-csv/workout-history-csv.page.ts`: `WorkoutHistoryCsvPage`
- `src/app/pages/workout-insights/workout-insights.page.ts`: `WorkoutInsightsPage`
- `src/app/pages/workout-summary/workout-summary.page.ts`: `WorkoutSummaryPage`

### Frontend components

- `src/app/components/achievement-badge/achievement-badge.component.ts`: `AchievementBadgeComponent`
- `src/app/components/agreements/agreement-modal/agreement-modal.component.ts`: `AgreementModalComponent`
- `src/app/components/agreements/service-agreement/service-agreement.component.ts`: `ServiceAgreementComponent`
- `src/app/components/availabilty/availabilty.component.ts`: `AvailabiltyComponent`
- `src/app/components/background-gradients/background-gradients.component.ts`: `BackgroundGradientsComponent`
- `src/app/components/badge-selector/badge-selector.component.ts`: `BadgeSelectorComponent`
- `src/app/components/blue-circle-gradient/blue-circle-gradient.component.ts`: `BlueCircleGradientComponent`
- `src/app/components/booking-message/booking-message.component.ts`: `BookingMessageComponent`
- `src/app/components/certifications/certifications.component.ts`: `CertificationsComponent`
- `src/app/components/file-preview/file-preview.component.ts`: `FilePreviewComponent`
- `src/app/components/greek-statue/greek-statue.component.ts`: `GreekStatueComponent`
- `src/app/components/header/header.component.ts`: `HeaderComponent`
- `src/app/components/image-carousel/image-carousel.component.ts`: `ImageCarouselComponent`
- `src/app/components/image-uploader/image-uploader.component.ts`: `ImageUploaderComponent`
- `src/app/components/leaderboard-shell/leaderboard-shell.component.ts`: `LeaderboardShellComponent`
- `src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component.ts`: `AppointmentSchedulerModalComponent`
- `src/app/components/modals/home-customization-modal/home-customization-modal.component.ts`: `HomeCustomizationModalComponent`
- `src/app/components/modals/workout-builder-modal/workout-builder-modal.component.ts`: `WorkoutBuilderModalComponent`
- `src/app/components/password-change-modal/password-change-modal.component.ts`: `PasswordChangeModalComponent`
- `src/app/components/payment-received-item/payment-received-item.component.ts`: `PaymentReceivedItemComponent`
- `src/app/components/phone-input/phone-input.component.ts`: `PhoneInputComponent`
- `src/app/components/search-modal/search-modal.component.ts`: `SearchModalComponent`
- `src/app/components/sessions/list-session-notes/list-session-notes.component.ts`: `ListSessionNotesComponent`
- `src/app/components/sessions/list-sessions/list-sessions.component.ts`: `ListSessionsComponent`
- `src/app/components/sessions/modal-session-cancel/modal-session-cancel.component.ts`: `ModalSessionCancelComponent`
- `src/app/components/sessions/session-notes/session-notes.component.ts`: `SessionNotesComponent`
- `src/app/components/sessions/session-reschedule-message/session-reschedule-message.component.ts`: `SessionRescheduleMessageComponent`
- `src/app/components/statue-selector/statue-selector.component.ts`: `StatueSelectorComponent`
- `src/app/components/time-picker-modal/time-picker-modal.component.ts`: `TimePickerModalComponent`
- `src/app/components/tool-tip/tool-tip.component.ts`: `ToolTipComponent`
- `src/app/components/video-uploader/video-uploader.component.ts`: `VideoUploaderComponent`

### Models and interfaces

- `src/app/models/workout-session.model.ts`: `ExerciseSet`, `ExerciseLog`, `SummaryExercise`, `TrainingType`, `RowWeight`, `WorkoutTrainingRow`, `CardioRoutePoint`, `CardioRouteBounds`, `CardioTrainingRow`, `OtherTrainingRow`, `WorkoutSessionPerformance`
- `src/app/models/user-stats.model.ts`: `Region`, `CardioScoreMap`, `StrengthScoreMap`, `UserScore`, `ExpectedEffortCategoryMap`, `ExpectedEffortMap`, `StreakData`, `EarlyMorningWorkoutsTracker`, `GroupRankingsMap`, `UserStats`, `UserLevelProgress`, `AddedScoreDaily`
- `src/app/models/exercise-estimators.model.ts`: `ExerciseEstimatorModel`, `ExerciseEstimatorCategory`, `EXERCISE_ESTIMATOR_ROOT_COLLECTION`, `EXERCISE_ESTIMATOR_PARENT_DOC`, `EXERCISE_ESTIMATOR_STRENGTH_CATEGORY`, `EXERCISE_ESTIMATOR_CARDIO_CATEGORY`, `EXERCISE_ESTIMATOR_WORKOUT_LOGS_COLLECTION`, `ExerciseEstimatorCoefficientMap`, `ExerciseEstimatorDoc`, `ExerciseEstimatorSeedDoc`
- `src/app/models/greek-statue.model.ts`: `StatueLevel`, `StoredStatueLevel`, `StatueCategory`, `StatueTier`, `GreekStatueDefinition`, `GreekStatue`, `STATUE_LEVELS`, `DEFAULT_STATUE_STAGE_IMAGES`, `STATUE_TIER_CONFIG`
- `src/app/models/user-badges.model.ts`: `UserBadgeLevel`, `UserBadgeStatDoc`, `UserBadgeStatsMap`
- `src/app/models/groups.model.ts`: `Group`
- `src/app/models/user.model.ts`: `AppUser`
- `src/app/models/video-analysis.model.ts`: `VideoLandmarkName`, `VideoAnalysisPoint`, `VideoAnalysisFrame`, `VideoAnalysisSeriesPoint`, `JointRangeSummary`, `MotionRangeSummary`, `DominantMovementSummary`, `RepCycleSummary`, `RepCountSummary`, `TempoSummary`, `SymmetryPairSummary`, `TrunkLeanSummary`, `BackAngleSummary`, `KneeValgusSummary`, `ElbowFlareSummary`, `VideoAnalysisResult`, `VideoCompressionResult`, `SavedVideoAnalysisRecord`
- `src/app/interfaces/Chats.ts`: `Message`, `Chat`, `ChatRequest`
- `src/app/interfaces/Calendar.ts`: `TimeSlot`, `TrainerAvailability`, `BookingRequest`
- `src/app/interfaces/Booking.ts`: `BookingData`
- `src/app/interfaces/Availability.ts`: `TimeWindow`, `DayAvailability`
- `src/app/interfaces/session-notes.interface.ts`: `SessionNote`, `SessionNoteAttachment`
- `src/app/interfaces/Agreement.ts`: `serviceOption`, `service`, `policyOption`, `policy`, `SignatureData`, `agreementData`, `AgreementTemplate`, `Agreement`
- `src/app/interfaces/Badge.ts`: `BadgeLevel`, `BadgeCategory`, `BadgeTier`, `AchievementBadge`, `BADGE_TIER_CONFIG`, `ACHIEVEMENT_BADGES`
- `src/app/interfaces/GreekStatue.ts`: `StatueLevel`, `StatueCategory`, `StatueTier`, `GreekStatue`, `DEFAULT_STATUE_STAGE_IMAGES`, `STATUE_TIER_CONFIG`, `GREEK_STATUES`
- `src/app/interfaces/profiles/BaseProfile.ts`: `BaseUserProfile`, `AuthProfile`
- `src/app/interfaces/profiles/client.ts`: `clientProfile`
- `src/app/interfaces/profiles/trainer.ts`: `trainerProfile`
- `src/app/interfaces/profiles/credentials.ts`: `credentials`
- `src/app/interfaces/client.ts`: `ClientProfile`
- `src/app/interfaces/trainer.ts`: `TrainerProfile`
- `src/app/interfaces/credentials.ts`: `Credentials`
- `src/app/interfaces/SessionReschedule.ts`: `SessionRescheduleRequest`
- `src/app/interfaces/environment.interface.ts`: `Environment`

### Backend functions and triggers

- `functions/src/index.ts`: `workoutChat`, `workoutChatCallable`, `treadmillLogger`, `treadmillLoggerCallable`, `completeWorkoutEvent`, `onWorkoutEventCreated`
- `functions/src/exerciseEstimatorTraining.ts`: `retrainExerciseEstimatorOnWorkoutLogCreate`
- `functions/src/stats/trainerStats.ts`: `onBookingChange`, `onTrainerClientChange`
- `functions/src/stats/migrateTrainerStats.ts`: `migrateTrainerStats`

## What is intentionally not visualized

- Templates, stylesheets, assets, generated Firebase Data Connect files, and test/spec files.
- Pipes and helper utilities, unless they materially affect object collaboration.
- Internal helper functions inside service/function files, except where they are represented implicitly by the owning object.
