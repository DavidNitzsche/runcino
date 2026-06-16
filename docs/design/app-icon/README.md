# Faff app icon

Source artwork: David's `Faff logo sq-02.png`, recoloured (not redrawn). The
letterforms / the A are masked straight from that PNG's alpha — nothing is
re-traced.

- Field: warm gradient `#FF5722` -> `#FC4D64` (race -> pink), diagonal.
- Letters: `#15151A` -> `#30242A` (charcoal -> ink), diagonal.
- Mark inset to 85% so it clears the iOS ~22.4% squircle mask.

## Files
- `faff-icon-1024.png` - MASTER. Opaque 1024x1024 square, no transparency, no
  pre-rounded corners. Drop into the AppIcon (single-size catalog) for iPhone
  and Apple Watch - iOS/watchOS applies its own rounding. Do NOT add a
  background or round it; it is already inset.
- `ios-square/` - full square size set (20-1024) for a multi-size catalog.
- `rounded/` - pre-rounded PNGs with transparent corners, for web favicon /
  PWA / previews only. NOT for the iOS AppIcon.
