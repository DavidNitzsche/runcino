import SwiftUI

struct ImportView: View {
    let onImport: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                brandHeader

                VStack(alignment: .leading, spacing: 8) {
                    Text("Run the course,")
                        .font(.system(size: 38, weight: .regular, design: .serif))
                    Text("not the clock.")
                        .font(.system(size: 38, weight: .regular, design: .serif))
                        .italic()
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 12)

                Text("AirDrop a .runcino.json plan from the web app, or open one from Files.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .padding(.trailing)

                Button(action: onImport) {
                    HStack {
                        Image(systemName: "tray.and.arrow.down")
                        Text("Import a plan")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.primary)
                    .foregroundColor(Color(.systemBackground))
                    .clipShape(Capsule())
                }
                .padding(.top, 12)

                howItWorksSection

                Spacer(minLength: 32)
            }
            .padding(20)
        }
    }

    private var brandHeader: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.orange.opacity(0.9))
                    .frame(width: 32, height: 32)
                Text("R")
                    .font(.system(size: 18, weight: .semibold, design: .serif))
                    .italic()
                    .foregroundColor(.white)
            }
            Text("Runcino")
                .font(.system(size: 22, weight: .medium, design: .serif))
            Spacer()
            Text("M0 · Big Sur")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var howItWorksSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How it works")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .kerning(1.4)

            VStack(alignment: .leading, spacing: 10) {
                HowItWorksRow(n: 1, text: "Build a plan on localhost:3000")
                HowItWorksRow(n: 2, text: "AirDrop the .runcino.json to this phone")
                HowItWorksRow(n: 3, text: "Review phases, fueling, landmarks")
                HowItWorksRow(n: 4, text: "Tap 'Add to Apple Watch'")
                HowItWorksRow(n: 5, text: "Run the race")
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(.secondarySystemBackground)))
    }
}

private struct HowItWorksRow: View {
    let n: Int
    let text: String
    var body: some View {
        HStack(spacing: 10) {
            Text("\(n)")
                .font(.caption.weight(.semibold))
                .frame(width: 20, height: 20)
                .background(Circle().fill(Color.orange.opacity(0.2)))
                .foregroundColor(.orange)
            Text(text)
                .font(.callout)
        }
    }
}

#Preview {
    ImportView(onImport: {})
}
