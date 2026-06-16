//
//  StravaPushSheet.swift
//  Slide-up panel for editing a run's Strava title + description before a
//  manual push (David 2026-06-16). Pre-filled with the server's smart default
//  title; the runner can rewrite the title and add an optional description,
//  then push — both ride up to Strava. Only shown when auto-push is OFF; with
//  auto-push on, the run publishes itself and the surface shows a status pill.
//

import SwiftUI

struct StravaPushSheet: View {
    @Binding var title: String
    @Binding var description: String
    /// True while the push is in flight · swaps the button to a spinner.
    var isPushing: Bool
    let onPush: () -> Void
    let onCancel: () -> Void

    private var titleEmpty: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header · title + close.
            HStack {
                Text("POST TO STRAVA")
                    .font(.label(13)).tracking(1.0)
                    .foregroundStyle(.white)
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white.opacity(0.55))
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 22).padding(.horizontal, 22).padding(.bottom, 20)

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    field("TITLE") {
                        TextField("", text: $title, axis: .vertical)
                            .font(.body(16, weight: .semibold))
                            .foregroundStyle(.white)
                            .tint(Color(hex: 0xFC4D24))
                            .lineLimit(1...2)
                    }
                    field("DESCRIPTION") {
                        TextField("Add a note (optional)", text: $description, axis: .vertical)
                            .font(.body(15))
                            .foregroundStyle(.white)
                            .tint(Color(hex: 0xFC4D24))
                            .lineLimit(4...10)
                    }
                }
                .padding(.horizontal, 22)
            }
            .scrollDismissesKeyboard(.interactively)

            // Push CTA.
            Button(action: { if !titleEmpty && !isPushing { onPush() } }) {
                HStack(spacing: 9) {
                    if isPushing {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "arrow.up.right.square.fill")
                            .font(.system(size: 14, weight: .bold))
                    }
                    Text(isPushing ? "PUSHING…" : "PUSH TO STRAVA")
                        .font(.body(15, weight: .extraBold)).tracking(0.3)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Color(hex: 0xFC4D24), in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(isPushing || titleEmpty)
            .opacity((isPushing || titleEmpty) ? 0.55 : 1)
            .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 26)
        }
        .background(Color(hex: 0x14161A).ignoresSafeArea())
    }

    @ViewBuilder
    private func field<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.label(11)).tracking(1.2)
                .foregroundStyle(.white.opacity(0.5))
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        }
    }
}
