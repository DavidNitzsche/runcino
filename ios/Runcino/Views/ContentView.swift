import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var store: PlanStore
    @State private var importerPresented = false

    var body: some View {
        NavigationStack {
            Group {
                if let plan = store.plan {
                    PlanView(plan: plan)
                } else {
                    ImportView(onImport: { importerPresented = true })
                }
            }
            .navigationTitle("Runcino")
            .toolbar {
                if store.plan != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Replace") { importerPresented = true }
                    }
                }
            }
            .fileImporter(
                isPresented: $importerPresented,
                allowedContentTypes: [runcinoJsonType, .json],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first {
                        store.importFromFile(at: url)
                    }
                case .failure(let error):
                    store.error = error.localizedDescription
                }
            }
            .alert("Import failed", isPresented: .constant(store.error != nil)) {
                Button("OK") { store.error = nil }
            } message: {
                Text(store.error ?? "")
            }
        }
    }
}

/// Custom UTType for .runcino.json — conforms to public.json. Declared
/// in Info.plist under UTExportedTypeDeclarations.
private let runcinoJsonType: UTType = {
    UTType(exportedAs: "com.davidnitzsche.runcino.plan", conformingTo: .json)
}()

#Preview {
    ContentView().environmentObject(PlanStore())
}
