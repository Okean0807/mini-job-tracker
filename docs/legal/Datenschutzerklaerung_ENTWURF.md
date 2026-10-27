> **ENTWURF – NICHT VERÖFFENTLICHEN.** Enthält unausgefüllte Pflichtangaben, offene Rechtsgrundlagen,
> Fristen und Vertragsangaben. Keine Rechtsberatung. Vor Veröffentlichung ausfüllen und juristisch
> prüfen lassen.
>
> Tatsachenbasis: App-Code (Stand `main`), Supabase-Projektregion eu-central-1 (Frankfurt),
> Vercel-Funktionsregion iad1 (USA-Ost). Rechtsgrundlagen, Verträge, Einstellungen bei den Anbietern und
> Fristen sind **nicht** belegt und deshalb als Feld offen.

# Datenschutzerklärung

## 1. Verantwortlicher

[[AUSFÜLLEN: Vor- und Nachname, ladungsfähige Anschrift, E-Mail – identisch mit dem Impressum]]

Datenschutzbeauftragter: [[ENTSCHEIDUNG: Benennung nur, wenn gesetzlich erforderlich (Art. 37 DSGVO,
§ 38 BDSG); sonst Abschnitt streichen]]

## 2. Überblick: Welche Daten wofür verarbeitet werden

| Zweck | Daten | Empfänger | Rechtsgrundlage | Speicherdauer |
|---|---|---|---|---|
| Bereitstellung der App, Sicherheit | IP-Adresse, Zeitpunkt, angeforderte Seite (Server-Logdaten), technische Fehlerangaben (z. B. HTTP-Status eines KI-Dienstes, Modellname) | Vercel | [[ENTSCHEIDUNG: z. B. Art. 6 Abs. 1 lit. f DSGVO – berechtigtes Interesse; prüfen]] | [[AUSFÜLLEN: Log-Aufbewahrung bei Vercel laut Vertrag/Plan]] |
| Anmeldung und Konto | E-Mail-Adresse und Profilangaben aus dem Google-Konto, Kennungen, Sitzungs-Token | Google (Anmeldung per OAuth), Supabase | [[ENTSCHEIDUNG: z. B. Art. 6 Abs. 1 lit. b DSGVO; prüfen]] | bis zur Kontolöschung [[prüfen]] |
| Speicherung deiner App-Daten (lokal, optional Cloud-Sicherung) | Jobs, Arbeitszeiten, Pausen, Stundenlöhne, Verdienst, Zahlungen, Abwesenheiten (auch Krankheit), Einstellungen, ggf. GPS-Koordinaten und Adresse eines Eintrags | Supabase (Datenbank, Region Frankfurt) | [[ENTSCHEIDUNG: Art. 6 Abs. 1 lit. b DSGVO; für Krankheitsangaben Art. 9 DSGVO prüfen]] | bis zur Löschung durch dich bzw. Kontolöschung [[prüfen]] |
| Dokumente | hochgeladene Dateien (PDF/Bilder), Dateiname, Typ, Größe, Ordner | Supabase Storage | [[ENTSCHEIDUNG: Art. 6 Abs. 1 lit. b DSGVO]] | bis zur Löschung/Kontolöschung [[prüfen]] |
| KI-Assistent (freiwillig) | deine Frage, Auszug aus App-Daten (Stundenlohn, Grenzwerte, Stunden/Verdienst, Jobbezeichnungen), Antworttext; ggf. abgeleitete Suchanfrage | Vercel (Server), Google (Gemini API), Tavily (Websuche) | [[ENTSCHEIDUNG: Einwilligung Art. 6 Abs. 1 lit. a DSGVO und/oder Vertrag lit. b; Hinweisdialog vor der ersten Nutzung ist vorhanden]] | [[AUSFÜLLEN: Aufbewahrung bei Google/Tavily laut Konto-/Vertragsbedingungen]]; lokaler KI-Verlauf bis zum Löschen/Kontolöschung |
| Adresse aus Standort (nur nach Bestätigung) | GPS-Koordinaten, IP-Adresse | OpenStreetMap Foundation (Nominatim) | Einwilligung Art. 6 Abs. 1 lit. a DSGVO (Abfrage nur nach Bestätigung im Dialog) [[prüfen]] | [[AUSFÜLLEN: laut Nominatim-Richtlinie]] |
| Rate-Limit für die KI | Kennung des Kontos, Zeitstempel der letzten KI-Anfragen | Supabase | [[ENTSCHEIDUNG: z. B. Art. 6 Abs. 1 lit. f DSGVO]] | wenige Minuten bis eine Stunde im Betrieb; Zeile bis Kontolöschung [[prüfen]] |

## 3. Cookies, lokale Speicherung, Tracking

- Die App verwendet **keine** Analyse- oder Werbe-Tracker.
- Schriftarten werden von der App selbst ausgeliefert; es erfolgt kein Abruf bei Google Fonts.
- Im Browser (localStorage) werden App-Daten, die Anmeldesitzung, der KI-Verlauf und die
  Bestätigung des KI-Hinweises gespeichert. Sie dienen dem von dir ausdrücklich gewünschten Betrieb der
  App. [[ENTSCHEIDUNG: Einstufung nach § 25 TDDDG („unbedingt erforderlich“) juristisch bestätigen]]

## 4. Empfänger und Auftragsverarbeiter

| Anbieter | Rolle | Vertrag (AVV/DPA) abgeschlossen? | Sitz/Region |
|---|---|---|---|
| Supabase | Auftragsverarbeiter (Anmeldung, Datenbank, Speicher) | [[AUSFÜLLEN: ja/nein, Datum, Fundstelle]] | Projektregion Frankfurt (eu-central-1) |
| Vercel | Auftragsverarbeiter (Hosting, Server-Funktion) | [[AUSFÜLLEN]] | Funktionsregion USA-Ost (iad1) |
| Google (Gemini API; Anmeldung) | [[ENTSCHEIDUNG: Auftragsverarbeiter/eigener Verantwortlicher je nach Dienst]] | [[AUSFÜLLEN: Kontotyp, Abrechnung, Bedingungen]] | [[AUSFÜLLEN]] |
| Tavily | [[ENTSCHEIDUNG]] | [[AUSFÜLLEN]] | [[AUSFÜLLEN]] |
| OpenStreetMap Foundation (Nominatim) | eigener Verantwortlicher | – | [[AUSFÜLLEN]] |

## 5. Übermittlung in Drittländer

Teile der Verarbeitung finden außerhalb der EU/des EWR statt (insbesondere Vercel-Server in den USA; Google
und Tavily [[AUSFÜLLEN: Standorte bestätigen]]).
Übermittlungsmechanismus je Anbieter: [[AUSFÜLLEN: Angemessenheitsbeschluss / Data Privacy Framework-
Zertifizierung des Anbieters (Eintrag prüfen) / Standardvertragsklauseln]].

## 6. Deine Rechte

Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18),
Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21 DSGVO) und Widerruf einer Einwilligung mit Wirkung für
die Zukunft (Art. 7 Abs. 3 DSGVO). Anfragen an: [[AUSFÜLLEN: E-Mail]].

Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO): [[AUSFÜLLEN: zuständige Landesdatenschutz-
behörde nach dem Wohnsitz des Verantwortlichen]].

## 7. Konto und Daten löschen

In den Einstellungen unter „Konto löschen“ werden Dokumente, Ordner, Cloud-Sicherungen und das Konto
gelöscht sowie die lokalen Kontodaten dieses Geräts (einschließlich KI-Verlauf). Lokale Daten auf
anderen Geräten und Browser-Sicherungen löschst du dort selbst. [[AUSFÜLLEN: Aufbewahrung von Sicherungen
(Backups) bei Supabase und Protokollen bei Vercel nach Konto-Einstellungen]]

## 8. Automatisierte Entscheidungen

Es findet keine automatisierte Entscheidung im Sinne von Art. 22 DSGVO statt. Antworten des KI-Assistenten
sind Informationen, keine Entscheidungen mit rechtlicher Wirkung und keine Rechts-, Steuer- oder
Sozialversicherungsberatung. [[prüfen]]

## 9. Änderungen

[[AUSFÜLLEN: Datum / Stand]]

---

### Offene Fragen an Betreiber/Jurist (nicht veröffentlichen)

1. Krankheits- und Abwesenheitseinträge können Gesundheitsdaten (Art. 9 DSGVO) sein: Rechtsgrundlage und
   ggf. ausdrückliche Einwilligung festlegen.
2. Gemini-API: Kontotyp (kostenlos/abgerechnet), Datennutzung, DPA – Bedingungen:
   <https://ai.google.dev/gemini-api/terms>.
3. Data Privacy Framework: Beschluss besteht; die Berufung (C-703/25 P) ist anhängig – Übermittlungs-
   mechanismus und Rückfallplan (SCC) festlegen.
4. Haushaltsausnahme (Art. 2 Abs. 2 lit. c DSGVO): Als Betreiber eines öffentlich angebotenen Dienstes ist der
   Betreiber voraussichtlich Verantwortlicher im Sinne der DSGVO – juristisch bestätigen lassen.
