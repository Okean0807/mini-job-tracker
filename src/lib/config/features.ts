/**
 * Build-time feature switches (R4, L3/L4).
 *
 * Both default to DISABLED: the feature is only on when the build env sets the
 * variable to the exact string "true".
 *
 * Static dot access (`import.meta.env.VITE_X`) is required: Vite only replaces
 * statically written keys. Bracket access with an unset key compiles to a
 * runtime lookup on an inlined env object, which is still `false` at runtime
 * but cannot be constant-folded, so the guarded code would stay in the bundle.
 *
 * - GEO_ENABLED   gates GPS capture (navigator.geolocation) and the
 *                 Nominatim reverse-geocoding lookup in ShiftDialog.
 * - VOICE_ENABLED gates browser SpeechRecognition entry points
 *                 (ShiftDialog note mic, Assistent mic, Assistent speak()).
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_GEO_ENABLED?: string;
    readonly VITE_VOICE_ENABLED?: string;
  }
}

export const GEO_ENABLED: boolean = import.meta.env.VITE_GEO_ENABLED === "true";
export const VOICE_ENABLED: boolean = import.meta.env.VITE_VOICE_ENABLED === "true";
