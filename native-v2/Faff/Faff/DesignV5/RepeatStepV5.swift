//
//  RepeatStepV5.swift
//  faff.run · press-and-hold repeat for the treadmill console's ± controls.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  Both belt consoles drove their ± controls from a plain `Button(action:)`:
//  one tap, one notch. A notch is 0.2 mph, so moving the belt from 6.0 to 9.0
//  meant landing FIFTEEN separate, well-separated taps — mid-run, on a moving
//  wrist-height phone, at cadence.
//
//  Measured on the simulator against the live console: three deliberately
//  spaced taps registered perfectly (8.4 → 9.0, exactly +0.2 each), while a
//  BURST of eighteen taps advanced the speed by a single notch. Whether a
//  rapid burst is coalesced by the touch system or dropped by the button, the
//  runner-visible result is identical and it is the shape David reported: he
//  changed the speed on the app, watched the number move a little, and the
//  recorded distance came out below what the treadmill's own display said.
//  The app was not ignoring him — it was counting roughly one tap in ten.
//
//  So a jab-jab-jab gesture is the wrong input for a value that needs to move
//  by fifteen notches. Hold instead: the value moves while the finger is
//  down, slowly at first so a single deliberate tap is still exactly one
//  notch, then faster, so three seconds of holding covers the whole range.
//
//  This does NOT fix a stale integrator — there is no longer one; the clock
//  moved onto the main body and the accumulator reads the live value at every
//  tick. It fixes the input that was silently under-counting.
//

import SwiftUI

struct RepeatStepV5<Label: View>: View {
    /// Called once per notch, including the first.
    let step: () -> Void
    @ViewBuilder var label: () -> Label

    /// A tap shorter than this is exactly one notch and nothing repeats.
    private static var delay: Double { 0.4 }
    /// Opening repeat rate, then accelerating. Slow enough that a runner who
    /// held slightly too long has not overshot by much.
    private static var startInterval: Double { 0.18 }
    private static var fastInterval: Double { 0.05 }
    /// Seconds of holding before the fast rate is reached.
    private static var rampSeconds: Double { 1.6 }

    @State private var pressing = false
    @State private var repeater: Task<Void, Never>?

    var body: some View {
        label()
            .contentShape(Circle())
            .scaleEffect(pressing ? 0.92 : 1)
            .animation(V5.Motion.press, value: pressing)
            // A DragGesture with a zero distance is the only way to know the
            // finger is STILL DOWN. `Button` reports a completed tap, and
            // `onLongPressGesture` reports one crossing of a threshold —
            // neither can drive a repeat.
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !pressing else { return }
                        pressing = true
                        step()                       // the tap itself
                        repeater = Task { @MainActor in
                            try? await Task.sleep(nanoseconds: UInt64(Self.delay * 1_000_000_000))
                            var held = 0.0
                            while !Task.isCancelled {
                                let t = min(held / Self.rampSeconds, 1)
                                let interval = Self.startInterval
                                    + (Self.fastInterval - Self.startInterval) * t
                                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                                if Task.isCancelled { return }
                                step()
                                held += interval
                            }
                        }
                    }
                    .onEnded { _ in
                        pressing = false
                        repeater?.cancel()
                        repeater = nil
                    }
            )
            .onDisappear { repeater?.cancel() }
    }
}
