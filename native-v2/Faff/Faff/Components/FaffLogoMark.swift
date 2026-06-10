//
//  FaffLogoMark.swift
//  FAFF wordmark rendered from the brand PNG asset.
//  Template rendering lets callers tint it to any color (default: Theme.txt).
//
//  Usage:
//    FaffLogoMark()                      // white, 22pt tall
//    FaffLogoMark(color: .black, height: 34)
//

import SwiftUI

struct FaffLogoMark: View {
    var color: Color = Theme.txt
    /// Height in points — width scales proportionally from the asset's native ratio.
    var height: CGFloat = 22

    // Native asset dimensions: 1790 × 373 px
    private let aspectRatio: CGFloat = 1790.0 / 373.0

    var body: some View {
        Image("FaffLogo")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: height * aspectRatio, height: height)
            .foregroundStyle(color)
    }
}
