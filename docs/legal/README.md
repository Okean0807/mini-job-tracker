# Rechtliche Texte (Entwürfe) – MiniJob Tracker

**Status: ENTWÜRFE. Nicht veröffentlichen.** Die Dateien in diesem Ordner enthalten bewusst
unausgefüllte Pflichtangaben, markiert als `[[AUSFÜLLEN: …]]` oder `[[ENTSCHEIDUNG: …]]`. Sie sind
keine Rechtsberatung und keine fertigen Rechtstexte.

| Datei | Zweck |
|---|---|
| `Impressum_ENTWURF.md` | Entwurf für Anbieterkennzeichnung (§ 5 DDG), Betreiber = natürliche Person |
| `Datenschutzerklaerung_ENTWURF.md` | Entwurf nach Art. 13 DSGVO, abgestimmt auf die tatsächliche Architektur |
| `Nutzungsbedingungen_ENTWURF.md` | Entwurf der Nutzungsbedingungen (zunächst kostenlos, spätere Monetarisierung offen) |
| `BETREIBER_CHECKLISTE.md` | Was der Betreiber bestätigen, abschließen oder entscheiden muss (Russisch) |

## Regeln

1. Die Entwürfe werden **nicht** in die App eingebunden. Die öffentlichen Seiten `/impressum`,
   `/datenschutz`, `/ki-hinweise` (`src/routes/`) bleiben als ausgewiesene Zwischenstände bestehen,
   bis der Betreiber die Angaben ergänzt und eine juristische Prüfung stattgefunden hat.
2. Kein Platzhalter darf in eine veröffentlichte Fassung gelangen. Der Test
   `src/lib/legal-drafts.test.ts` stellt sicher, dass die Entwürfe als Entwurf gekennzeichnet sind
   und nicht von der App importiert werden.
3. Alle Tatsachenangaben in den Entwürfen stammen aus Code, Konfigurationsmetadaten (Supabase
   Projektregion, Vercel Funktionsregion) und den Anbieter-Dokumentationen zum Stand der Erstellung.
   Verträge, Konten-Einstellungen und Fristen sind **nicht** belegt und deshalb als Feld offen.
4. Nach Veröffentlichung: Texte in `src/routes/*.tsx` übernehmen, die Hinweis-Boxen „noch keine
   endgültige …“ entfernen und die Tests zu den Platzhaltern anpassen.
