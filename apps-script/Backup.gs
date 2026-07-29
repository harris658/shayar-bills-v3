/**
 * Nightly copy of the whole spreadsheet into a Drive folder, pruned to the
 * last 30. Sheets version history is not programmatically restorable; this is.
 */

const BACKUP_FOLDER_ = 'Bills Backups';
const BACKUP_KEEP_ = 30;

function backupFolder_() {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER_);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER_);
}

function nightlyBackup() {
  const folder = backupFolder_();
  const stamp = Utilities.formatDate(
    new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const file = DriveApp.getFileById(ss_().getId());
  file.makeCopy('bills-' + stamp, folder);
  pruneBackups_(folder);
}

function pruneBackups_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('bills-') === 0) files.push(f);
  }
  files.sort(function (a, b) {
    return b.getDateCreated().getTime() - a.getDateCreated().getTime();
  });
  files.slice(BACKUP_KEEP_).forEach(function (f) { f.setTrashed(true); });
}

/** Run once by hand from the editor. Safe to re-run — it clears its own duplicates. */
function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyBackup').timeBased().atHour(2).everyDays(1).create();
  Logger.log('nightly backup trigger installed for ~2am');
}
