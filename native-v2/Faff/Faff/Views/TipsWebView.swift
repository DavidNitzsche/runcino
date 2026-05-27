//
//  TipsWebView.swift  (POC 2026-05-27)
//
//  Wraps the web /tips page inside a WKWebView so the iPhone can inherit
//  every web change for free instead of maintaining a parallel Swift port.
//
//  This is a PROOF OF CONCEPT for the "web-view some content-heavy
//  surfaces" architectural option. Side-by-side comparison flow:
//
//    - Default: native TipsView renders.
//    - Toggle "Try web view" at the top of TipsView swaps to TipsWebView.
//    - Toggle "Switch to native" inside TipsWebView swaps back.
//    - Choice persists via UserDefaults("faff.tips.useWebView") so you
//      can keep using your preferred version.
//
//  The web page reads ?embed=ios and hides TopNav + tightens padding so
//  it nests inside the native tab-bar chrome without doubling up.
//

import SwiftUI
import WebKit

struct TipsWebView: View {
    @AppStorage("faff.tips.useWebView") private var useWebView: Bool = true
    @State private var isLoading: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            // Native header strip so this still feels like part of the app.
            // The web page itself drops its top nav in embed mode; this
            // gives us a place to put the back-to-native toggle.
            HStack(alignment: .firstTextBaseline) {
                Text("TIPS · WEB VIEW POC")
                    .font(.label(10))
                    .tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Spacer()
                Button("Switch to native") {
                    useWebView = false
                }
                .font(.label(10))
                .tracking(1.2)
                .foregroundStyle(Theme.green)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 10)

            ZStack {
                WebViewRepresentable(
                    url: URL(string: "https://www.faff.run/tips?embed=ios")!,
                    isLoading: $isLoading
                )
                if isLoading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                        .frame(maxHeight: .infinity)
                        .background(Theme.bg)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
    }
}

/// UIViewRepresentable bridge for WKWebView.
private struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isLoading: $isLoading)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Don't let the web view inject media controls or do anything weird.
        config.allowsInlineMediaPlayback = false
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = context.coordinator
        // Match the app's dark background so there's no white flash during
        // navigation. WKWebView has its own background separate from the
        // page background.
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0.04, green: 0.05, blue: 0.06, alpha: 1.0)
        wv.scrollView.backgroundColor = UIColor(red: 0.04, green: 0.05, blue: 0.06, alpha: 1.0)
        // Hide the horizontal scroll indicator; vertical is fine.
        wv.scrollView.showsHorizontalScrollIndicator = false
        // Bounce feels native iOS, keep it.
        wv.scrollView.bounces = true
        wv.load(URLRequest(url: url))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No-op. We don't currently reload on prop changes; the URL is fixed
        // for this POC.
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var isLoading: Bool

        init(isLoading: Binding<Bool>) {
            _isLoading = isLoading
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }
    }
}
