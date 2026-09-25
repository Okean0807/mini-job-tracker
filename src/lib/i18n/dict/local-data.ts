import type { Bundle, Lang } from "../core";

/** Texte für Konto-/Testmodus-Isolation und den expliziten Import lokaler Daten. */
const de = {
  "error.accountMismatch":
    "Die geladenen lokalen Daten gehören nicht zum angemeldeten Konto – Abgleich gestoppt.",
  "set.account.cloud.signOutFailed":
    "Abmelden fehlgeschlagen. Du bist weiterhin angemeldet – bitte erneut versuchen.",
  "local.import.legacy.title": "Lokale Daten von diesem Gerät gefunden",
  "local.import.legacy.body":
    "Auf diesem Gerät liegen Daten aus einer früheren App-Version ({shifts} Schichten, {jobs} Jobs, {docs} Dokumente). Sie werden keinem Konto automatisch zugeordnet.",
  "local.import.legacy.sameAccount": "Diese Daten wurden zuletzt mit diesem Konto synchronisiert.",
  "local.import.legacy.import": "In dieses Konto übernehmen",
  "local.import.legacy.importLocal": "Auf diesem Gerät übernehmen",
  "local.import.demo.title": "Testdaten übernehmen?",
  "local.import.demo.body":
    "Du hast im Testmodus Daten erfasst ({shifts} Schichten, {jobs} Jobs, {docs} Dokumente). Sie werden nicht automatisch in dein Konto übernommen.",
  "local.import.demo.import": "Testdaten übernehmen",
  "local.import.demo.empty": "Mit leerem Konto starten",
  "local.import.later": "Später",
  "local.import.ignore": "Ignorieren",
  "local.import.cloudHint":
    "Existiert bereits ein Cloud-Backup, wirst du anschließend gefragt, welcher Stand gelten soll – nichts wird still überschrieben.",
  "local.import.done": "Daten übernommen.",
  "local.import.refusedUnsynced":
    "Dein Konto hat noch nicht gesicherte Änderungen. Bitte zuerst sichern, dann übernehmen.",
  "local.import.refusedNotEmpty":
    "Hier sind bereits Daten vorhanden – Übernahme abgebrochen, nichts wurde überschrieben.",
  "local.import.notEligible": "Übernahme hier nicht möglich.",
  "local.section.title": "Lokale Daten auf diesem Gerät",
  "local.section.desc":
    "Daten aus einer früheren App-Version oder aus dem Testmodus werden nie automatisch einem Konto zugeordnet.",
  "local.section.legacy": "Daten aus früherer App-Version",
  "local.section.demo": "Testmodus-Daten",
  "local.section.discard": "Endgültig löschen",
  "local.section.legacyImported":
    "Bereits übernommen. Die alten Daten bleiben als Sicherung auf dem Gerät, bis du sie löschst.",
  "local.section.discardConfirm":
    "Die alten lokalen Daten (frühere App-Version) wirklich endgültig von diesem Gerät löschen? Dies kann nicht rückgängig gemacht werden.",
  "local.section.discarded": "Alte lokale Daten gelöscht.",
  "local.section.counts": "{shifts} Schichten · {jobs} Jobs · {docs} Dokumente",
};

const en: typeof de = {
  "error.accountMismatch":
    "The loaded local data does not belong to the signed-in account – sync stopped.",
  "set.account.cloud.signOutFailed": "Sign-out failed. You are still signed in – please try again.",
  "local.import.legacy.title": "Local data found on this device",
  "local.import.legacy.body":
    "This device holds data from an earlier app version ({shifts} shifts, {jobs} jobs, {docs} documents). It is never assigned to an account automatically.",
  "local.import.legacy.sameAccount": "This data was last synced with this account.",
  "local.import.legacy.import": "Import into this account",
  "local.import.legacy.importLocal": "Use on this device",
  "local.import.demo.title": "Import test data?",
  "local.import.demo.body":
    "You recorded data in test mode ({shifts} shifts, {jobs} jobs, {docs} documents). It is not imported into your account automatically.",
  "local.import.demo.import": "Import test data",
  "local.import.demo.empty": "Start with an empty account",
  "local.import.later": "Later",
  "local.import.ignore": "Ignore",
  "local.import.cloudHint":
    "If a cloud backup already exists you will be asked which version to keep – nothing is overwritten silently.",
  "local.import.done": "Data imported.",
  "local.import.refusedUnsynced":
    "Your account has unsynced changes. Please back up first, then import.",
  "local.import.refusedNotEmpty":
    "Data already exists here – import cancelled, nothing was overwritten.",
  "local.import.notEligible": "Import is not possible here.",
  "local.section.title": "Local data on this device",
  "local.section.desc":
    "Data from an earlier app version or from test mode is never assigned to an account automatically.",
  "local.section.legacy": "Data from earlier app version",
  "local.section.demo": "Test mode data",
  "local.section.discard": "Delete permanently",
  "local.section.legacyImported":
    "Already imported. The old data stays on this device as a backup until you delete it.",
  "local.section.discardConfirm":
    "Really delete the old local data (earlier app version) from this device? This cannot be undone.",
  "local.section.discarded": "Old local data deleted.",
  "local.section.counts": "{shifts} shifts · {jobs} jobs · {docs} documents",
};

// ru/tr/pl: English until translated (German stays the global fallback for missing keys).
const langs: Record<Lang, typeof de> = { de, en, ru: en, tr: en, pl: en };
export const localDataDict: Bundle = langs;
