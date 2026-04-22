import Foundation
import HealthKit
import Combine
import WatchConnectivity

final class WorkoutManager: NSObject, ObservableObject, WCSessionDelegate {
    let healthStore = HKHealthStore()

    @Published var heartRate: Double = 0
    @Published var isWorkoutRunning = false

    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?

    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        setupWatchConnectivity()

        let typesToShare: Set = [HKObjectType.workoutType()]
        let typesToRead: Set = [
            HKObjectType.quantityType(forIdentifier: .heartRate)!
        ]

        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { success, error in
            if let error = error {
                print("Health authorization error: \(error.localizedDescription)")
            } else {
                print("Health authorization success: \(success)")
            }
        }
    }

    private func setupWatchConnectivity() {
        guard WCSession.isSupported() else {
            print("WCSession not supported on watch")
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()
        print("Watch WCSession setup started")
    }

    func startWorkout() {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor

        do {
            workoutSession = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            workoutBuilder = workoutSession?.associatedWorkoutBuilder()

            workoutSession?.delegate = self
            workoutBuilder?.delegate = self

            workoutBuilder?.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: configuration
            )

            let startDate = Date()
            print("Starting workout at \(startDate)")
            workoutSession?.startActivity(with: startDate)

            workoutBuilder?.beginCollection(withStart: startDate) { success, error in
                if let error = error {
                    print("Begin collection error: \(error.localizedDescription)")
                } else {
                    DispatchQueue.main.async {
                        self.isWorkoutRunning = success
                    }
                    print("Begin collection success: \(success)")
                }
            }
        } catch {
            print("Unable to start workout: \(error.localizedDescription)")
        }
    }

    func stopWorkout() {
        workoutSession?.end()
    }

    private func sendHeartRateToPhone(value: Double) {
        let session = WCSession.default

        print("Attempting to send HR to phone: \(Int(value)) BPM")
        print("Watch session reachable? \(session.isReachable)")

        guard session.isReachable else {
            print("iPhone not reachable right now")
            return
        }

        let payload: [String: Any] = [
            "type": "heartRateUpdate",
            "heartRate": Int(value),
            "timestamp": Date().timeIntervalSince1970
        ]

        session.sendMessage(
            payload,
            replyHandler: { reply in
                print("Phone replied: \(reply)")
            },
            errorHandler: { error in
                print("sendMessage error: \(error.localizedDescription)")
            }
        )
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error = error {
            print("WCSession activation error: \(error.localizedDescription)")
        } else {
            print("WCSession activated on watch: \(activationState.rawValue)")
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        print("Watch reachability changed: \(session.isReachable)")
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        print("Workout session failed: \(error.localizedDescription)")
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        DispatchQueue.main.async {
            self.isWorkoutRunning = (toState == .running)
        }

        print("Workout session state changed from \(fromState.rawValue) to \(toState.rawValue)")

        if toState == .ended {
            workoutBuilder?.endCollection(withEnd: date) { success, error in
                self.workoutBuilder?.finishWorkout { workout, error in
                    if let error = error {
                        print("Finish workout error: \(error.localizedDescription)")
                    } else {
                        print("Workout finished successfully")
                    }
                }
            }
        }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
    }

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType) else {
            return
        }

        let unit = HKUnit.count().unitDivided(by: HKUnit.minute())
        let value = statistics.mostRecentQuantity()?.doubleValue(for: unit) ?? 0

        DispatchQueue.main.async {
            self.heartRate = value
            print("Watch got HR update: \(Int(value)) BPM")
            self.sendHeartRateToPhone(value: value)
        }
    }
}
