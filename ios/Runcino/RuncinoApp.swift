import SwiftUI

@main
struct RuncinoApp: App {
    @StateObject private var planStore = PlanStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(planStore)
        }
    }
}

/// App-wide holder for the currently-loaded plan.
@MainActor
final class PlanStore: ObservableObject {
    @Published var plan: RuncinoPlan?
    @Published var error: String?

    func importFromFile(at url: URL) {
        // iCloud / Files may need security-scoped access
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            let plan = try decoder.decode(RuncinoPlan.self, from: data)
            try RuncinoPlan.validate(plan)
            self.plan = plan
            self.error = nil
        } catch {
            self.error = "Failed to load plan: \(error.localizedDescription)"
        }
    }
}
