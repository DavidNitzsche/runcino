/**
 * Setting copy that the BROWSER is allowed to import.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM lib/coach/settings.ts
 *
 * `lib/coach/settings.ts` imports the pg pool. A client component importing a
 * VALUE from it — a type-only import is erased, a value is not — drags pg into
 * the browser bundle, and `next build` dies with "Can't resolve 'dns'".
 *
 * That is what has been failing every deploy since `5335af97`: SettingsForm is
 * a 'use client' component and it imported PHONE_RUN_SETTING_COPY, a value,
 * from the module that owns the pool. The type imports beside it were fine and
 * always had been, which is why it reads as safe.
 *
 * So the copy lives here, with no imports at all, and both sides can have it.
 */

/**
 * The "start runs from this phone" switch. Its help text is not decoration:
 * phone recording is foreground-only and there is no heart rate without a
 * watch, and this switch is the single source of truth for whether the phone
 * offers to record at all.
 */
export const PHONE_RUN_SETTING_COPY = {
  label: 'Start runs from this phone',
  help:
    'Keep the screen on while you run. The phone stops recording in your pocket. ' +
    'No heart rate without a watch.',
} as const;
