import type { Bundle, Lang } from "../core";

/** Wiederherstellungspunkte (Snapshots) auf diesem Gerät – nur Anzeigen, Herunterladen, Löschen. */
const de = {
  "guarded.dialog.pinAdopted":
    "Achtung: Dieses alte Backup enthält noch eine PIN. Da dieses Gerät keine hat, wird sie hier gesetzt. Möchtest du das nicht, brich ab.",
  "guarded.cancelled": "Abgebrochen – es wurde nichts verändert.",
  "guarded.unchanged": "Beide Stände sind bereits gleich – nichts ersetzt.",
  "guarded.abort.generic":
    "Der Vorgang wurde aus Sicherheitsgründen abgebrochen. Nichts wurde verändert.",
  "guarded.abort.lockBusy": "Es läuft bereits eine andere Datenoperation. Nichts wurde verändert.",
  "guarded.abort.scopeChanged": "Das Konto hat gewechselt. Nichts wurde verändert.",
  "guarded.abort.localChanged":
    "Die lokalen Daten haben sich während des Vorgangs geändert. Nichts wurde verändert – bitte neu vergleichen.",
  "guarded.abort.remoteChanged":
    "Die Cloud-Sicherung hat sich geändert. Nichts wurde verändert – bitte neu vergleichen.",
  "guarded.abort.invalidPayload":
    "Die Daten sind ungültig oder beschädigt. Nichts wurde verändert.",
  "guarded.abort.prepareFailed":
    "Der Vergleich konnte nicht erstellt werden. Nichts wurde verändert.",
  "guarded.abort.remoteMissing": "Es gibt keine Cloud-Sicherung. Nichts wurde verändert.",
  "guarded.abort.snapshotFailed":
    "Die Wiederherstellungskopie konnte nicht gespeichert werden. Nichts wurde verändert.",
  "guarded.abort.verificationFailed":
    "Die Wiederherstellungskopie ist nicht lesbar/geprüft. Nichts wurde verändert.",
  "guarded.abort.commitFailed": "Das Ersetzen ist fehlgeschlagen.",
  "guarded.dialog.title.cloud-backup": "Cloud-Sicherung überschreiben?",
  "guarded.dialog.title.conflict-keep-local": "Lokalen Stand behalten und Cloud überschreiben?",
  "guarded.dialog.title.cloud-restore": "Cloud-Stand auf dieses Gerät laden?",
  "guarded.dialog.title.conflict-keep-cloud": "Cloud-Stand behalten und lokale Daten ersetzen?",
  "guarded.dialog.title.local-import": "Datei importieren und lokale Daten ersetzen?",
  "guarded.dialog.title.snapshot-restore": "Wiederherstellungspunkt zurückspielen?",
  "guarded.dialog.replaces.local": "Ersetzt wird: die lokalen Daten auf diesem Gerät.",
  "guarded.dialog.replaces.cloud": "Ersetzt wird: die Cloud-Sicherung.",
  "guarded.dialog.current": "Bisher (wird ersetzt)",
  "guarded.dialog.incoming": "Neu (ersetzt)",
  "guarded.dialog.counts": "{shifts} Schichten · {jobs} Jobs · {other} weitere",
  "guarded.dialog.none": "keine Daten",
  "guarded.dialog.lost": "Gehen verloren",
  "guarded.dialog.added": "Kommen hinzu",
  "guarded.dialog.changed": "Geändert",
  "guarded.dialog.settings": "Abweichende Einstellungen: {keys}",
  "guarded.dialog.integrity":
    "{n} Unstimmigkeiten in den neuen Daten (z. B. verwaiste Verweise). Es wird nichts repariert oder gelöscht.",
  "guarded.dialog.snapshot":
    "Vorher wird eine Wiederherstellungskopie auf diesem Gerät gespeichert und geprüft. Schlägt das fehl, wird nichts verändert.",
  "guarded.dialog.device": "PIN und Biometrie dieses Geräts bleiben unverändert.",
  "guarded.dialog.identical": "Beide Stände sind gleich.",
  "guarded.dialog.confirm": "Ja, ersetzen",
  "guarded.dialog.cancel": "Abbrechen",
  "guarded.col.shifts": "Schichten",
  "guarded.col.jobs": "Jobs",
  "guarded.col.customers": "Kunden",
  "guarded.col.projects": "Projekte",
  "guarded.col.payments": "Zahlungen",
  "guarded.col.goals": "Ziele",
  "guarded.col.orders": "Aufträge",
  "guarded.col.objects": "Objekte",
  "backup.snap.restore": "Zurückspielen",
  "backup.snap.restored": "Wiederherstellungspunkt zurückgespielt.",
  "error.cas.stale":
    "Die Cloud-Sicherung wurde zwischenzeitlich geändert. Es wurde nichts überschrieben – bitte neu vergleichen.",
  "error.cas.accountGone": "Das Konto existiert nicht mehr. Es wurde nichts gespeichert.",
  "error.cas.auth": "Keine Berechtigung für die Cloud-Sicherung. Bitte erneut anmelden.",
  "error.cas.ambiguous":
    "Das Ergebnis des Speicherns ist unklar. Beim nächsten Abgleich wird es geprüft – es wird nichts blind wiederholt.",
  "backup.snap.title": "Wiederherstellungspunkte",
  "backup.snap.desc":
    "Vor riskanten Vorgängen (z. B. Import oder Wiederherstellung) legt die App einen geprüften Sicherheitsstand auf diesem Gerät ab. Hier siehst du ihn, kannst ihn herunterladen, zurückspielen oder löschen.",
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
  "guarded.dialog.pinAdopted":
    "Note: this old backup still contains a PIN. Because this device has none, it would be set here. Cancel if you do not want that.",
  "guarded.cancelled": "Cancelled – nothing was changed.",
  "guarded.unchanged": "Both versions are already identical – nothing replaced.",
  "guarded.abort.generic": "The operation was stopped for safety. Nothing was changed.",
  "guarded.abort.lockBusy": "Another data operation is already running. Nothing was changed.",
  "guarded.abort.scopeChanged": "The account changed. Nothing was changed.",
  "guarded.abort.localChanged":
    "Local data changed during the operation. Nothing was changed – please compare again.",
  "guarded.abort.remoteChanged":
    "The cloud backup changed. Nothing was changed – please compare again.",
  "guarded.abort.invalidPayload": "The data is invalid or damaged. Nothing was changed.",
  "guarded.abort.prepareFailed": "The comparison could not be created. Nothing was changed.",
  "guarded.abort.remoteMissing": "There is no cloud backup. Nothing was changed.",
  "guarded.abort.snapshotFailed": "The recovery copy could not be saved. Nothing was changed.",
  "guarded.abort.verificationFailed":
    "The recovery copy could not be verified. Nothing was changed.",
  "guarded.abort.commitFailed": "Replacing failed.",
  "guarded.dialog.title.cloud-backup": "Overwrite the cloud backup?",
  "guarded.dialog.title.conflict-keep-local": "Keep local data and overwrite the cloud?",
  "guarded.dialog.title.cloud-restore": "Load the cloud version onto this device?",
  "guarded.dialog.title.conflict-keep-cloud": "Keep the cloud version and replace local data?",
  "guarded.dialog.title.local-import": "Import the file and replace local data?",
  "guarded.dialog.title.snapshot-restore": "Restore this recovery point?",
  "guarded.dialog.replaces.local": "Will be replaced: the local data on this device.",
  "guarded.dialog.replaces.cloud": "Will be replaced: the cloud backup.",
  "guarded.dialog.current": "Current (will be replaced)",
  "guarded.dialog.incoming": "New (replaces)",
  "guarded.dialog.counts": "{shifts} shifts · {jobs} jobs · {other} other",
  "guarded.dialog.none": "no data",
  "guarded.dialog.lost": "Will be lost",
  "guarded.dialog.added": "Will be added",
  "guarded.dialog.changed": "Changed",
  "guarded.dialog.settings": "Differing settings: {keys}",
  "guarded.dialog.integrity":
    "{n} inconsistencies in the new data (e.g. orphaned references). Nothing is repaired or deleted.",
  "guarded.dialog.snapshot":
    "A recovery copy is saved on this device and verified first. If that fails, nothing is changed.",
  "guarded.dialog.device": "This device's PIN and biometrics stay unchanged.",
  "guarded.dialog.identical": "Both versions are identical.",
  "guarded.dialog.confirm": "Yes, replace",
  "guarded.dialog.cancel": "Cancel",
  "guarded.col.shifts": "Shifts",
  "guarded.col.jobs": "Jobs",
  "guarded.col.customers": "Customers",
  "guarded.col.projects": "Projects",
  "guarded.col.payments": "Payments",
  "guarded.col.goals": "Goals",
  "guarded.col.orders": "Orders",
  "guarded.col.objects": "Objects",
  "backup.snap.restore": "Restore",
  "backup.snap.restored": "Recovery point restored.",
  "error.cas.stale":
    "The cloud backup changed in the meantime. Nothing was overwritten – please compare again.",
  "error.cas.accountGone": "The account no longer exists. Nothing was saved.",
  "error.cas.auth": "Not permitted to access the cloud backup. Please sign in again.",
  "error.cas.ambiguous":
    "The result of saving is unclear. It will be checked at the next sync – nothing is retried blindly.",
  "backup.snap.title": "Recovery points",
  "backup.snap.desc":
    "Before risky operations (e.g. import or restore) the app keeps a verified safety copy on this device. Here you can view it, download it, restore it or delete it.",
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
