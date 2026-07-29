/**
 * Nightly copy of the whole spreadsheet into a Drive folder, pruned to the
 * last 30 days. Sheets version history is not programmatically restorable;
 * this is. One copy per calendar day — a same-day re-run replaces, not
 * duplicates. The folder is pinned by ID (stored in Script Properties) so a
 * second Drive folder that happens to share the "Bills Backups" name can
 * never silently steal future backups.
 */

const BACKUP_FOLDER_ = 'Bills Backups';
const BACKUP_KEEP_ = 30;
const BACKUP_FOLDER_ID_PROP_ = 'BACKUP_FOLDER_ID';
const BACKUP_NAME_RE_ = /^bills-\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the backup folder by pinned ID first (fast path, immune to
 * duplicate-name collisions), falling back to find-or-create-by-name if the
 * stored ID is missing or no longer resolves (folder deleted/trashed). Always
 * re-persists the ID it settles on so later runs take the fast path.
 */
function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty(BACKUP_FOLDER_ID_PROP_);
  if (storedId) {
    try {
      const folder = DriveApp.getFolderById(storedId);
      if (!folder.isTrashed()) return folder;
    } catch (e) {
      // Stored ID no longer resolves. Fall through and find-or-create.
    }
  }

  const it = DriveApp.getFoldersByName(BACKUP_FOLDER_);
  let folder;
  if (it.hasNext()) {
    folder = it.next();
    if (it.hasNext()) {
      Logger.log('warning: multiple Drive folders named "' + BACKUP_FOLDER_ +
        '" exist; pinning to the first one found (' + folder.getId() + ')');
    }
  } else {
    folder = DriveApp.createFolder(BACKUP_FOLDER_);
  }
  props.setProperty(BACKUP_FOLDER_ID_PROP_, folder.getId());
  return folder;
}

function nightlyBackup() {
  const folder = backupFolder_();
  const stamp = Utilities.formatDate(
    new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const name = 'bills-' + stamp;
  replaceExisting_(folder, name);
  const file = DriveApp.getFileById(ss_().getId());
  file.makeCopy(name, folder);
  pruneBackups_(folder);
}

/** Trashes any file already named `name` in `folder` — keeps same-day re-runs to one copy. */
function replaceExisting_(folder, name) {
  const it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
}

/** Only ever touches files this script itself produced — never a lookalike dropped in by hand. */
function pruneBackups_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (BACKUP_NAME_RE_.test(f.getName())) files.push(f);
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
