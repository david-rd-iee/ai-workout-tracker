#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WorkoutSessionPlugin, "WorkoutSession",
    CAP_PLUGIN_METHOD(checkAvailability, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestAuthorization, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startWorkout, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopWorkout, CAPPluginReturnPromise);
)
