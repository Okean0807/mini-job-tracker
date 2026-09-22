# Registrierung, OAuth-Rückkehr und Settings-Oberfläche

## Tatsächlicher Codepfad

| Schritt | Ort |
|---|---|
| Wizard-Gate | `routes/__root.tsx` → `shouldShowOnboardingWizard(settings, jobs)` (`lib/minijob/wizard-flow.ts`) |
| Welcome + Sprache | `OnboardingWizard` Schritt 0 (`WIZARD_STEP_INDEX.welcome`) |
| Registrierung/Login | Schritt 1 (`cloud`): Google → `signInWithOAuthProvider` oder Testmodus → `startLocalDemo` |
| Checkpoint vor OAuth | `checkpointOnboardingBeforeOAuth({ step: oauthResumeStep() })` → Draft `minijob-onboarding-draft-v2` |
| OAuth-Start | `lib/minijob/oauth-sign-in.ts` → `supabase.auth.signInWithOAuth` (PKCE) |
| Rückkehr | Redirect-Ziel aus `oauthRedirectTo(path)`; Code-Tausch macht supabase-js selbst (`detectSessionInUrl`) |
| Session-Status | `hooks/use-auth-session.ts` → `bindAuthSession` (erst subscriben, dann `getSession`) |
| Wiederaufnahme | `resolveWizardResumeStep(draft.step, authStatus)` → nach Google immer Arbeitsmodell |
| Cloud-Abgleich | `initCloudSync` → `decideSync`; vollständiges Remote-Profil schließt den Wizard (`isWizardComplete`) |
| Abschluss | `finish()` → Job + `onboarded`/`wizardCompletedAt` → `goToDashboard()` |
| Einstellungen | genau eine Route/Komponente: `routes/einstellungen.tsx` |

Sollzustand je Nutzer:

- neu: Welcome → Google → Arbeitsmodell → personalisiertes Onboarding → Abschluss → Dashboard
- bestehend, abgeschlossen: Welcome → Google → Restore → Dashboard (kein Wizard)
- bestehend, unvollständig: Welcome → Google → Wizard ab Arbeitsmodell (Draft-Schritt bleibt erhalten)

## Behobene Ursachen

1. **Rückkehrziel und Abschluss.** `oauthRedirectTo()` zeigte fest auf `/einstellungen`, und
   `finish()` schloss nur das Overlay. Die Registrierung endete dadurch in den Einstellungen
   statt im Dashboard. Jetzt: Wizard-Login kehrt auf `/` zurück, `finish()` navigiert zum
   Dashboard; ein in den Einstellungen gestarteter Login kehrt weiterhin dorthin zurück.
2. **Stille Callback-Fehler.** Fehlte der PKCE-Verifier (anderer Browser/In-App-Browser,
   geleerter Speicher, partitionierter Embed-Storage), entstand keine Session, keine Meldung,
   und `?code=` blieb in der Adresszeile — ein Reload wiederholte denselben toten Code.
   `lib/minijob/oauth-callback.ts` + `AuthCallback` in `__root.tsx` melden das jetzt und
   räumen die URL auf.
3. **OAuth in eingebetteter Vorschau.** Google beantwortet die Authorize-Anfrage mit
   `frame-ancestors 'none'`. Im iframe (Lovable-Editor-Vorschau) ersetzte der Redirect die App
   durch eine Browser-Fehlerseite. `isEmbeddedContext()` erkennt das und übergibt den Flow an
   einen Top-Level-Tab (`/?oauth=google`), in dem Verifier und Callback dieselbe Storage-Partition
   benutzen.

## Settings-Oberfläche

Es gibt genau eine Implementierung: Route `/einstellungen` mit den Tabs Allgemein, Design, Lohn,
Konto. Keine Legacy-Route, kein Alias, kein Feature-Flag und keine workMode-/onboarding-abhängige
Variante — abgesichert durch `routes/einstellungen.canonical.test.ts`. Der einzige
zustandsabhängige Teil ist der Konto-Tab (abgemeldet → „Anmelden“, angemeldet → „Cloud-Sicherung“).
Alte Cloud-Sicherungen können die alte Struktur nicht zurückholen: `replaceAll` → `normalize`
ergänzt fehlende Felder mit `DEFAULT_SETTINGS`.

## Verbleibender manueller Production-Smoke

Automatisiert getestet wird der komplette Flow gegen eine lokale Supabase-Attrappe; der
Identity Provider selbst (Google-Consent, Supabase-Redirect-Allowlist) lässt sich lokal nicht
abbilden. In Produktion daher noch prüfen:

1. Supabase → Authentication → URL Configuration: `Site URL` und `Redirect URLs` müssen den
   Dashboard-Pfad (`https://<host>/`) **und** `https://<host>/einstellungen` enthalten.
   Ohne den neuen Eintrag `/` schlägt die Rückkehr nach der Registrierung fehl.
2. Neue Google-Registrierung in einem eigenen Browser-Tab (nicht im Editor-iframe):
   Welcome → Sprache → Google → Arbeitsmodell → Onboarding → Abschluss → Dashboard.
3. Reload nach Abschluss: Dashboard bleibt, kein Wizard.
4. Abmelden → erneut anmelden: Einstellungen, kein Wizard, Daten unverändert.
5. Registrierung in der eingebetteten Vorschau: Klick auf „Mit Google anmelden“ öffnet einen
   neuen Tab; Hinweis-Toast erscheint; im neuen Tab läuft der Flow bis zum Dashboard.
6. Abbruch im Google-Dialog: Rückkehr zeigt „Anmeldung nicht abgeschlossen“ und eine saubere URL.
