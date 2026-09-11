import SwiftUI

@main
struct HyperMobileApp: App {
    var body: some Scene {
        WindowGroup {
            HealthSyncScheduler {
                if UIDevice.current.userInterfaceIdiom == .pad {
                    NativePadRootView()
                } else {
                    NativeRootView()
                }
            }
        }
    }
}
