import SwiftUI

struct ContentView: View {
    @StateObject private var workoutManager = WorkoutManager()

    var body: some View {
        VStack(spacing: 12) {
            Text("Atlas")
                .font(.headline)

            Text(workoutManager.isWorkoutRunning ? "Live Session Running" : "Not Running")
                .font(.caption)
                .foregroundColor(workoutManager.isWorkoutRunning ? .green : .gray)

            Text("\(Int(workoutManager.heartRate)) BPM")
                .font(.system(size: 28, weight: .bold))

            Button(workoutManager.isWorkoutRunning ? "Stop Session" : "Start Session") {
                if workoutManager.isWorkoutRunning {
                    workoutManager.stopWorkout()
                } else {
                    workoutManager.startWorkout()
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .onAppear {
            workoutManager.requestAuthorization()
        }
    }
}

#Preview {
    ContentView()
}
