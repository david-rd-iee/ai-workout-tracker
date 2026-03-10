import Foundation
import Capacitor
import HealthKit

@objc(WorkoutSessionPlugin)
public class WorkoutSessionPlugin: CAPPlugin {
    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var heartRateQuery: HKQuery?
    
    @objc func checkAvailability(_ call: CAPPluginCall) {
        if HKHealthStore.isHealthDataAvailable() {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false])
        }
    }
    
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }
        
        let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate)!
        let workoutType = HKObjectType.workoutType()
        
        let typesToRead: Set<HKObjectType> = [heartRateType, workoutType]
        let typesToShare: Set<HKSampleType> = [workoutType]
        
        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { success, error in
            if success {
                call.resolve(["authorized": true])
            } else {
                call.reject("Authorization failed: \(error?.localizedDescription ?? "Unknown error")")
            }
        }
    }
    
    @objc func startWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }
        
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .functionalStrengthTraining
        configuration.locationType = .indoor
        
        do {
            workoutSession = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            workoutBuilder = workoutSession?.associatedWorkoutBuilder()
            
            workoutBuilder?.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: configuration
            )
            
            workoutSession?.delegate = self
            workoutBuilder?.delegate = self
            
            let startDate = Date()
            workoutSession?.startActivity(with: startDate)
            workoutBuilder?.beginCollection(withStart: startDate) { success, error in
                if success {
                    self.startHeartRateQuery()
                    call.resolve(["started": true])
                } else {
                    call.reject("Failed to start workout: \(error?.localizedDescription ?? "Unknown error")")
                }
            }
        } catch {
            call.reject("Failed to create workout session: \(error.localizedDescription)")
        }
    }
    
    @objc func stopWorkout(_ call: CAPPluginCall) {
        guard let session = workoutSession else {
            call.reject("No active workout session")
            return
        }
        
        session.end()
        
        workoutBuilder?.endCollection(withEnd: Date()) { success, error in
            if success {
                self.workoutBuilder?.finishWorkout { workout, error in
                    if let error = error {
                        call.reject("Failed to save workout: \(error.localizedDescription)")
                    } else {
                        call.resolve(["stopped": true, "saved": true])
                    }
                }
            } else {
                call.reject("Failed to end workout: \(error?.localizedDescription ?? "Unknown error")")
            }
        }
        
        if let query = heartRateQuery {
            healthStore.stop(query)
            heartRateQuery = nil
        }
    }
    
    private func startHeartRateQuery() {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            return
        }
        
        let predicate = HKQuery.predicateForSamples(
            withStart: Date(),
            end: nil,
            options: .strictStartDate
        )
        
        let query = HKAnchoredObjectQuery(
            type: heartRateType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit
        ) { query, samples, deletedObjects, anchor, error in
            self.processSamples(samples)
        }
        
        query.updateHandler = { query, samples, deletedObjects, anchor, error in
            self.processSamples(samples)
        }
        
        healthStore.execute(query)
        heartRateQuery = query
    }
    
    private func processSamples(_ samples: [HKSample]?) {
        guard let heartRateSamples = samples as? [HKQuantitySample] else {
            return
        }
        
        for sample in heartRateSamples {
            let heartRateUnit = HKUnit.count().unitDivided(by: HKUnit.minute())
            let heartRate = sample.quantity.doubleValue(for: heartRateUnit)
            
            // Send event to JavaScript
            notifyListeners("heartRateUpdate", data: [
                "heartRate": heartRate,
                "timestamp": ISO8601DateFormatter().string(from: sample.startDate)
            ])
        }
    }
}

extension WorkoutSessionPlugin: HKWorkoutSessionDelegate {
    public func workoutSession(_ workoutSession: HKWorkoutSession, 
                              didChangeTo toState: HKWorkoutSessionState, 
                              from fromState: HKWorkoutSessionState, 
                              date: Date) {
        DispatchQueue.main.async {
            switch toState {
            case .running:
                self.notifyListeners("workoutStateChanged", data: ["state": "running"])
            case .ended:
                self.notifyListeners("workoutStateChanged", data: ["state": "ended"])
            case .paused:
                self.notifyListeners("workoutStateChanged", data: ["state": "paused"])
            case .prepared:
                self.notifyListeners("workoutStateChanged", data: ["state": "prepared"])
            case .stopped:
                self.notifyListeners("workoutStateChanged", data: ["state": "stopped"])
            @unknown default:
                break
            }
        }
    }
    
    public func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        notifyListeners("workoutError", data: ["error": error.localizedDescription])
    }
}

extension WorkoutSessionPlugin: HKLiveWorkoutBuilderDelegate {
    public func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, 
                              didCollectDataOf collectedTypes: Set<HKSampleType>) {
        // Data collection events
    }
    
    public func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
        // Workout events
    }
}
