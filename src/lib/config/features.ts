/**
 * Build-time feature switches (R4, L3/L4).
 *
 * Both default to DISABLED: the feature is only on when the build env sets the
 * variable to the exact string "true". Vite inlines `import.meta.env[...]`
 * literals at build time, so with the flag unset the guarded branches become
 * constant-false and the bundler can drop them (verified via dist grep).
 *
 * - GEO_ENABLED   gates GPS capture (navigator.geolocation) and the
 *                 Nominatim reverse-geocoding lookup in ShiftDialog.
 * - VOICE_ENABLED gates browser SpeechRecognition entry points
 *                 (ShiftDialog note mic, Assistent mic).
 */
export const GEO_ENABLED: boolean = import.meta.env["VITE_GEO_ENABLED"] === "true";
export const VOICE_ENABLED: boolean = import.meta.env["VITE_VOICE_ENABLED"] === "true";
