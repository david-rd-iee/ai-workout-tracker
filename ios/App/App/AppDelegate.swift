import UIKit
import Capacitor
import WatchConnectivity

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, WCSessionDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        setupWatchConnectivity()
        return true
    }

    private func setupWatchConnectivity() {
        guard WCSession.isSupported() else {
            print("WCSession not supported on iPhone")
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()

        print("iPhone WCSession setup started")
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(
            application,
            continue: userActivity,
            restorationHandler: restorationHandler
        )
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error = error {
            print("iPhone WCSession activation error: \(error.localizedDescription)")
        } else {
            print("iPhone WCSession activated: \(activationState.rawValue)")
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        print("iPhone WCSession became inactive")
    }

    func sessionDidDeactivate(_ session: WCSession) {
        print("iPhone WCSession deactivated")
        WCSession.default.activate()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        print("iPhone reachability changed: \(session.isReachable)")
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String : Any],
        replyHandler: @escaping ([String : Any]) -> Void
    ) {
        print("iPhone received message: \(message)")

        guard let type = message["type"] as? String,
              type == "heartRateUpdate",
              let heartRate = message["heartRate"] as? Int,
              let timestamp = message["timestamp"] as? Double else {
            replyHandler(["status": "invalidMessage"])
            return
        }

        print("✅ Heart rate from watch: \(heartRate) BPM at \(timestamp)")

        UserDefaults.standard.set(String(heartRate), forKey: "CapacitorStorage.latestWatchHeartRate")
        UserDefaults.standard.set(String(timestamp), forKey: "CapacitorStorage.latestWatchHeartRateTimestamp")
        UserDefaults.standard.synchronize()

        replyHandler(["status": "ok"])
    }
}
