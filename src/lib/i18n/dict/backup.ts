import type { Bundle, Lang } from "../core";

/** Wiederherstellungspunkte (Snapshots) auf diesem Gerät – nur Anzeigen, Herunterladen, Löschen. */
const de = {
  "backup.snap.title": "Wiederherstellungspunkte",
  "backup.snap.desc":
    "Vor riskanten Vorgängen (z. B. Import oder Wiederherstellung) kann die App einen Sicherheitsstand auf diesem Gerät ablegen. Hier siehst du ihn, kannst ihn als Datei herunterladen oder löschen. Zurückspielen ist hier noch nicht möglich.",
  "backup.snap.privacy":
    "Datenschutz: Wiederherstellungspunkte bleiben nach dem Abmelden auf diesem Gerät, bis du sie hier löschst oder dein Konto gelöscht wird. Sie enthalten deine Daten, aber keine PIN und keine Biometrie. Auf einem geteilten Gerät bitte löschen.",
  "backup.snap.empty": "Keine Wiederherstellungspunkte vorhanden.",
  "backup.snap.loading": "Wird geladen …",
  "backup.snap.unavailable":
    "Wiederherstellungspunkte sind in diesem Browser nicht verfügbar (Speicher gesperrt).",
  "backup.snap.loadError": "Wiederherstellungspunkte konnten nicht gelesen werden.",
  "backup.snap.kind.local_pre_restore": "Vor lokaler Wiederherstellung",
  "backup.snap.kind.cloud_pre_overwrite": "Vor Überschreiben der Cloud-Sicherung",
  "backup.snap.kind.local_pre_import": "Vor Datei-Import",
  "backup.snap.counts": "{shifts} Schichten · {jobs} Jobs · {other} weitere Einträge",
  "backup.snap.range": "Schichten von {from} bis {to}",
  "backup.snap.size": "{size} KB",
  "backup.snap.download": "Herunterladen",
  "backup.snap.delete": "Löschen",
  "backup.snap.deleteAll": "Alle löschen",
  "backup.snap.deleteConfirm": "Diesen Wiederherstellungspunkt endgültig von diesem Gerät löschen?",
  "backup.snap.deleteAllConfirm":
    "Alle Wiederherstellungspunkte dieses Kontos auf diesem Gerät endgültig löschen?",
  "backup.snap.deleted": "Wiederherstellungspunkt gelöscht.",
  "backup.snap.deletedAll": "Alle Wiederherstellungspunkte gelöscht.",
  "backup.snap.downloaded": "Wiederherstellungspunkt heruntergeladen.",
  "backup.snap.actionError": "Das hat nicht geklappt. Bitte erneut versuchen.",
  "backup.snap.verifyError":
    "Der Wiederherstellungspunkt ist beschädigt und wurde nicht heruntergeladen.",
};

const en: typeof de = {
  "backup.snap.title": "Recovery points",
  "backup.snap.desc":
    "Before risky operations (e.g. import or restore) the app can keep a safety copy on this device. Here you can view it, download it as a file or delete it. Restoring from here is not available yet.",
  "backup.snap.privacy":
    "Privacy: recovery points stay on this device after you sign out until you delete them here or your account is deleted. They contain your data but no PIN and no biometrics. Please delete them on a shared device.",
  "backup.snap.empty": "No recovery points.",
  "backup.snap.loading": "Loading …",
  "backup.snap.unavailable": "Recovery points are not available in this browser (storage blocked).",
  "backup.snap.loadError": "Recovery points could not be read.",
  "backup.snap.kind.local_pre_restore": "Before local restore",
  "backup.snap.kind.cloud_pre_overwrite": "Before overwriting the cloud backup",
  "backup.snap.kind.local_pre_import": "Before file import",
  "backup.snap.counts": "{shifts} shifts · {jobs} jobs · {other} other records",
  "backup.snap.range": "Shifts from {from} to {to}",
  "backup.snap.size": "{size} KB",
  "backup.snap.download": "Download",
  "backup.snap.delete": "Delete",
  "backup.snap.deleteAll": "Delete all",
  "backup.snap.deleteConfirm": "Permanently delete this recovery point from this device?",
  "backup.snap.deleteAllConfirm":
    "Permanently delete all recovery points of this account on this device?",
  "backup.snap.deleted": "Recovery point deleted.",
  "backup.snap.deletedAll": "All recovery points deleted.",
  "backup.snap.downloaded": "Recovery point downloaded.",
  "backup.snap.actionError": "That did not work. Please try again.",
  "backup.snap.verifyError": "The recovery point is damaged and was not downloaded.",
};

// ru/tr/pl: English until translated (German stays the global fallback for missing keys).
const langs: Record<Lang, typeof de> = { de, en, ru: en, tr: en, pl: en };
export const backupDict: Bundle = langs;
