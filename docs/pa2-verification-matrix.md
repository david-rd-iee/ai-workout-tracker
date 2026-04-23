# PA2 Verification Matrix (Revised Spring 2026 Requirements)

This verification matrix is based on the revised requirement text provided in the project discussion, including:

- Functional Requirements `FR-1.1` through `FR-3.2`
- Non-Functional Requirements `NFR-1.1` through `NFR-6.1`
- Use Cases `UC-1` through `UC-21`

Status labels:

- `Satisfied`: implemented and materially aligned with the requirement
- `Partial`: feature exists, but acceptance criteria are only partly met or not fully evidenced
- `Not Satisfied`: missing or clearly below requirement scope
- `Not Verified`: implementation may exist, but measurable proof was not found

## Functional Requirements

| ID | Requirement | Current Evidence | Status | Notes / Gaps |
|---|---|---|---|---|
| `FR-1.1` | User Authentication and Profile Management | [login.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/login/login.page.ts), [sign-up.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/sign-up/sign-up.page.ts), [account.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/account/account.service.ts), [profile-settings.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/profile-settings/profile-settings.page.ts) | `Partial` | Separate account types exist and profile editing is implemented. Email/password login exists, but OAuth provider support is not clearly evidenced as production-ready for the full registration path. Password reset and `<2s` persistence are not fully verified here. |
| `FR-1.2` | Trainer-Client Relationship | [client-find-trainer.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-find-trainer/client-find-trainer.page.ts), [user.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/account/user.service.ts), [client-details.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-details/client-details.page.ts) | `Satisfied` | Clients can search/select trainers, relationship records are stored, and trainers can view connected clients. Cross-device synchronization is plausible through Firestore-backed state. |
| `FR-1.3` | AI Workout Chatbot | [workout-chatbot.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/workout-chatbot/workout-chatbot.page.ts), [functions/src/index.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/functions/src/index.ts), [workout-summary.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/workout-summary/workout-summary.page.ts) | `Partial` | Natural-language workout logging, structured summaries, and trainer notes support are present. The `85%` extraction accuracy and `<3s` response target are not proven by current evidence. |
| `FR-1.4` | Hierarchical Leaderboards | [leaderboard.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/leaderboard.service.ts), [regional-leaderboard.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/leaderboards/regional-leaderboard/regional-leaderboard.page.ts), [leaderboard.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/leaderboards/leaderboard/leaderboard.page.ts) | `Partial` | Leaderboard infrastructure exists and regional filtering appears implemented. Clear evidence for all four scopes `global/country/state/city`, all top-100 constraints, and all score-type views with measured `<2s` loading is not fully established. |
| `FR-1.5` | Greek Statue Achievement System | [greek-statue.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/greek-statue/greek-statue.component.ts), [user-badges.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/user-badges.service.ts), [profile-user.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/profile-user/profile-user.page.ts) | `Satisfied` | The statue system is clearly implemented with staged progression and visible profile display. |
| `FR-2.1` | Form Check Video Recording | [camera.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/camera/camera.page.ts) | `Partial` | Camera permission handling, recording, preview, and trainer-side analysis storage are present. Upload completion within `30s` and explicit 2-minute constraint evidence were not verified. |
| `FR-2.2` | Form Check Video Annotation | [trainer-workout-analyzer.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/trainer-workout-analyzer/trainer-workout-analyzer.page.ts), [video-analysis-viewer.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/video-analysis-viewer/video-analysis-viewer.component.ts) | `Partial` | Annotation tooling exists, but the exact acceptance targets like `7+` preset colors and `2px-12px` line width range were not re-verified here. |
| `FR-2.3` | Annotated Video Export | [video-analysis-viewer.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/video-analysis-viewer/video-analysis-viewer.component.ts) | `Partial` | There is evidence of annotated analysis output and storage, but the full exported burned-in video requirement with timestamp accuracy, notification, and `720p` minimum is not fully proven. |
| `FR-2.4` | Workout Session Summary | [workout-summary.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/workout-summary/workout-summary.page.ts), [workout-summary.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/workout-summary.service.ts), [shared/models/workout-event.model.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/shared/models/workout-event.model.ts) | `Satisfied` | Summaries include exercises, notes, calories, and persistence. Trainer/client visibility is substantially represented in current flows. |
| `FR-2.5` | Work Score Calculation | [update-score.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/update-score.service.ts), [leaderboard.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/leaderboard.service.ts), [functions/src/workoutEventPostWriteHandlers.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/functions/src/workoutEventPostWriteHandlers.ts) | `Partial` | Work score infrastructure exists, but exact formula compliance to the revised PA2 wording and the `within 10 seconds` reflection target were not fully proven here. |
| `FR-2.6` | Workout Builder | [workout-builder-modal.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/modals/workout-builder-modal/workout-builder-modal.component.ts), [client-details.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-details/client-details.page.ts) | `Partial` | Trainers can create workouts with sets/reps/weight/notes and assign them in flow. The `30+` exercise library target and full client assignment/view lifecycle need stronger evidence. |
| `FR-2.7` | Real-time Messaging | [chats.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/chats.service.ts), [chat-detail.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/chats/chat-detail/chat-detail.page.ts), [groups.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/groups/groups.page.ts) | `Partial` | Messaging, unread badges, and group/social messaging features exist. The `<2s` delivery SLA, push notification proof, and load-tested 10-person group chat evidence are not established. |
| `FR-2.8` | Session Booking System | [session-booking.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/session-booking.service.ts), [appointment-scheduler-modal.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component.ts), [trainer-calendar.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/calender/trainer-calendar/trainer-calendar.page.ts), [client-calendar.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/calender/client-calendar/client-calendar.page.ts) | `Satisfied` | Availability, booking flow, upcoming sessions, and calendar integration are present. |
| `FR-2.9` | Agreement Management | [service-agreement.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/agreements/service-agreement/service-agreement.component.ts) | `Satisfied` | Agreement template generation, PDF creation, signature capture workflow, and storage are materially represented. |
| `FR-3.1` | Extended Health Tracking | No direct implementation found | `Not Satisfied` | Sleep, nutrition, hydration, and trend dashboards were not found. |
| `FR-3.2` | AI-Powered Exercise Recommendations | No clear dedicated recommendation engine found | `Not Satisfied` | Chatbot advice exists, but not a distinct recommendation system based on 30 days of history with explanations and feedback loop. |

## Non-Functional Requirements

| ID | Requirement | Current Evidence | Status | Notes / Gaps |
|---|---|---|---|---|
| `NFR-1.1` | UI interactions within 1 second on target devices | No timing benchmark artifacts found | `Not Verified` | Build and app run, but no 1000-interaction performance evidence was found. |
| `NFR-1.2` | Leaderboard queries within 2 seconds up to 100,000 users | [leaderboard.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/leaderboard.service.ts) | `Not Verified` | Query logic exists, but no scale/load-test evidence was found. |
| `NFR-1.3` | Video uploads within 30 seconds for 2-minute clips | [camera.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/camera/camera.page.ts), [video-analysis.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/video-analysis.service.ts) | `Not Verified` | Upload flow exists, but simulated mobile network timing proof was not found. |
| `NFR-2.1` | TLS 1.3 for all transmission | Firebase-backed networking throughout app | `Partial` | Security likely relies on Firebase transport security, but exact TLS 1.3 verification is not documented here. |
| `NFR-2.2` | Password hashing with bcrypt work factor 12 | Firebase Authentication handles credentials | `Partial` | The app does not directly manage password hashing; this is delegated to Firebase Auth. The PA2 acceptance wording is therefore not directly evidenced in repo-owned code. |
| `NFR-2.3` | Firestore security rules enforce access control | App uses Firestore extensively, but rules were not audited in this pass | `Not Verified` | This needs direct Firebase rules review and penetration testing evidence. |
| `NFR-3.1` | Sync recovers from network interruptions without data loss | Firestore-backed sync architecture exists | `Not Verified` | No offline/recovery test evidence was found. |
| `NFR-4.1` | Onboarding completed within 5 minutes by 90% of new users | [sign-up.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/sign-up/sign-up.page.ts), [profile-creation.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/profile-creation/profile-creation.page.ts) | `Not Verified` | Flow exists, but no timed usability study evidence was found. |
| `NFR-4.2` | Consistent UI/UX following Ionic guidelines | Broad shared UI system now exists across many screens | `Partial` | The app is visually consistent in many areas, but a formal Ionic-guideline design review was not found. |
| `NFR-5.1` | 80% code coverage | [karma.conf.js](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/karma.conf.js), many `*.spec.ts` files | `Not Verified` | Test infrastructure exists, but no current coverage report proving `>=80%` was found. |
| `NFR-6.1` | iOS 14+ and Android 10+ compatibility | Ionic/Capacitor-style app structure | `Not Verified` | No device matrix results were found in this pass. |

## Use Case Verification

| UC ID | Use Case | Mapped Requirement | Current Evidence | Status | Notes / Gaps |
|---|---|---|---|---|---|
| `UC-1` | Register Account | `FR-1.1` | [login.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/login/login.page.ts), [sign-up.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/sign-up/sign-up.page.ts) | `Satisfied` | Core registration/login flow exists. |
| `UC-2` | Search and Connect with Trainer | `FR-1.2` | [client-find-trainer.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-find-trainer/client-find-trainer.page.ts) | `Satisfied` | Implemented. |
| `UC-3` | Record Form Check Video | `FR-2.1` | [camera.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/camera/camera.page.ts) | `Partial` | Implemented flow, but acceptance metrics not fully evidenced. |
| `UC-4` | View Annotated Feedback Video | `FR-2.3` | [client-analyzed-video.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-analyzed-video/client-analyzed-video.page.ts), [analyzed-videos.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/analyzed-videos/analyzed-videos.page.ts) | `Partial` | Viewing support exists, but export guarantees need proof. |
| `UC-5` | Log Workout via AI Chatbot | `FR-1.3` | [workout-chatbot.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/workout-chatbot/workout-chatbot.page.ts) | `Partial` | Implemented, acceptance targets not fully verified. |
| `UC-6` | View Workout Summary | `FR-2.4` | [workout-summary.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/workout-summary/workout-summary.page.ts) | `Satisfied` | Implemented. |
| `UC-7` | View Leaderboard Rankings | `FR-1.4` | [regional-leaderboard.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/leaderboards/regional-leaderboard/regional-leaderboard.page.ts), [leaderboard.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/leaderboards/leaderboard/leaderboard.page.ts) | `Partial` | Leaderboards exist, but full revised scope not fully evidenced. |
| `UC-8` | Track Greek Statue Progress | `FR-1.5` | [greek-statue.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/greek-statue/greek-statue.component.ts), [profile-user.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/profile-user/profile-user.page.ts) | `Satisfied` | Implemented. |
| `UC-9` | Book Training Session | `FR-2.8` | [appointment-scheduler-modal.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component.ts), [session-booking.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/session-booking.service.ts) | `Satisfied` | Implemented. |
| `UC-10` | Send Message to Trainer/Client | `FR-2.7` | [chats.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/chats.service.ts), [chat-detail.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/chats/chat-detail/chat-detail.page.ts) | `Partial` | Messaging exists; delivery/performance targets remain unverified. |
| `UC-11` | Sign Agreement/Waiver | `FR-2.9` | [service-agreement.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/agreements/service-agreement/service-agreement.component.ts) | `Satisfied` | Implemented. |
| `UC-12` | Make Payment for Services | Deferred | Partial payment-related UI exists, but current semester scope says deferred | `Not Satisfied` | Should be treated as deferred per the revised PA2 text. |
| `UC-13` | Annotate Client Form Check Video | `FR-2.2`, `FR-2.3` | [trainer-workout-analyzer.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/trainer-workout-analyzer/trainer-workout-analyzer.page.ts), [video-analysis-viewer.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/video-analysis-viewer/video-analysis-viewer.component.ts) | `Partial` | Tooling exists; export/timing criteria need stronger proof. |
| `UC-14` | Create Workout Program | `FR-2.6` | [workout-builder-modal.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/modals/workout-builder-modal/workout-builder-modal.component.ts) | `Partial` | Builder exists; complete client assignment lifecycle needs stronger evidence. |
| `UC-15` | Review Client Workout History | `FR-2.4` | [workout-history.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/workout-history/workout-history.page.ts), [client-workout-analysis.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-workout-analysis/client-workout-analysis.page.ts) | `Satisfied` | Implemented enough to satisfy the use case. |
| `UC-16` | Set Availability Schedule | `FR-2.8` | [trainer-calendar.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/calender/trainer-calendar/trainer-calendar.page.ts) | `Satisfied` | Implemented. |
| `UC-17` | Create Agreement Template | `FR-2.9` | [service-agreement.component.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/components/agreements/service-agreement/service-agreement.component.ts) | `Satisfied` | Implemented enough for the use case. |
| `UC-18` | Manage Client Relationships | `FR-1.2` | [client-details.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-details/client-details.page.ts), [user.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/account/user.service.ts) | `Satisfied` | Implemented. |
| `UC-19` | Add Session Notes | `FR-2.4` | [client-details.page.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/pages/client-details/client-details.page.ts), [workout-event.model.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/shared/models/workout-event.model.ts) | `Partial` | Trainer notes capability exists in workout data models and summary flows, but the exact UX path should be validated end-to-end. |
| `UC-20` | Calculate Work Scores | `FR-2.5` | [update-score.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/update-score.service.ts) | `Partial` | Calculation infrastructure exists, but revised formula compliance still needs formal verification. |
| `UC-21` | Update Leaderboard Rankings | `FR-1.4` | [leaderboard.service.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/src/app/services/leaderboard.service.ts), [functions/src/workoutEventPostWriteHandlers.ts](/c:/Users/isaac/CAPSTONE/ai-workout-tracker/functions/src/workoutEventPostWriteHandlers.ts) | `Partial` | Dynamic updates appear to exist, but revised PA2 ranking guarantees need proof. |

## Overall Summary

### Likely satisfied now

- `FR-1.2` Trainer-client relationship
- `FR-1.5` Greek statue achievement system
- `FR-2.4` Workout session summary
- `FR-2.8` Session booking system
- `FR-2.9` Agreement management
- `UC-1`, `UC-2`, `UC-6`, `UC-8`, `UC-9`, `UC-11`, `UC-15`, `UC-16`, `UC-17`, `UC-18`

                                                                                                                                                                                                                                                                                                            ### Implemented but still partial against revised PA2 acceptance criteria

                                                                                                                                                                                                                                                                                                            - `FR-1.1`, `FR-1.3`, `FR-1.4`
                                                                                                                                                                                                                                                                                                            - `FR-2.1`, `FR-2.2`, `FR-2.3`, `FR-2.5`, `FR-2.6`, `FR-2.7`
                                                                                                                                                                                                                                                                                                            - Most leaderboard and CV/video flows due to missing measurable evidence
- Most NFRs due to lack of explicit test artifacts

### Not satisfied against revised PA2

- `FR-3.1` Extended health tracking
- `FR-3.2` AI-powered exercise recommendations
- `UC-12` payment for services should be treated as deferred, not complete

## Recommended Reporting Language

Suggested conclusion for the assignment/report:

> The current version satisfies several core Spring 2026 product requirements, especially trainer-client relationship management, Greek Statue gamification, workout summaries, session booking, and agreement workflows. However, a number of requirements remain only partially satisfied because measurable acceptance criteria such as latency, extraction accuracy, upload duration, leaderboard scale, and test coverage have not yet been formally verified. Extended health tracking and AI-powered exercise recommendations are not currently implemented, and payment features should remain classified as deferred according to the revised PA2 scope.
