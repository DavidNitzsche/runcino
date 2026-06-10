//
//  FaffLogoMark.swift
//  FAFF blocky wordmark — geometric letter shapes matching the brand asset.
//
//  Geometry: viewBox 0 0 442 100 (4.42 : 1 aspect), 4 letters at
//  x = 0 / 114 / 228 / 342 with 14-unit gaps.
//
//  F = stem (42×100 rx14) + top-bar (100×30 rx14) + mid-bar (88×22 rx11)
//  A = solid block (100×100 rx16) minus top-slot (12×58 rx6) and
//      bottom-notch (12×24 rx6) punched via .destinationOut + .compositingGroup
//
//  Usage:
//    FaffLogoMark()                      // white, 22pt tall
//    FaffLogoMark(color: .black, height: 34)
//

import SwiftUI

struct FaffLogoMark: View {
    var color: Color = Theme.txt
    /// Height in points — width scales proportionally (4.42 : 1).
    var height: CGFloat = 22

    private var s: CGFloat { height / 100 }

    var body: some View {
        HStack(alignment: .top, spacing: 14 * s) {
            fLetter
            aLetter
            fLetter
            fLetter
        }
        .frame(width: 442 * s, height: height)
    }

    // MARK: - F letter

    private var fLetter: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 14 * s)
                .fill(color)
                .frame(width: 42 * s, height: 100 * s)
            RoundedRectangle(cornerRadius: 14 * s)
                .fill(color)
                .frame(width: 100 * s, height: 30 * s)
            RoundedRectangle(cornerRadius: 11 * s)
                .fill(color)
                .frame(width: 88 * s, height: 22 * s)
                .offset(y: 44 * s)
        }
        .frame(width: 100 * s, height: 100 * s)
    }

    // MARK: - A letter (block with punched-out slot counters)

    private var aLetter: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 16 * s)
                .fill(color)
                .frame(width: 100 * s, height: 100 * s)
            // Top slot — carves the counter from the top of the block
            RoundedRectangle(cornerRadius: 6 * s)
                .fill(color)
                .frame(width: 12 * s, height: 58 * s)
                .offset(x: 44 * s)
                .blendMode(.destinationOut)
            // Bottom notch — carves the counter from the bottom
            RoundedRectangle(cornerRadius: 6 * s)
                .fill(color)
                .frame(width: 12 * s, height: 24 * s)
                .offset(x: 44 * s, y: 76 * s)
                .blendMode(.destinationOut)
        }
        .frame(width: 100 * s, height: 100 * s)
        .compositingGroup()
    }
}
