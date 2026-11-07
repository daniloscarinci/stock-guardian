# Backup reminder

**Status:** design approved, not implemented
**Date:** 2026-11-07

Tell the user when they last made a backup, and warn them when they have
unsaved changes and the last backup is old. Offline, no notifications, no new
permission, no database migration.

---

## Why

The application keeps everything in a database on the device, and nothing
syncs. The README already says so: iOS can clear the storage of a site that
sits unopened for about a week, and an Android reinstall signed with a
different key wipes the database. The only protection is an exported backup,
and nothing today tells anyone when they last made one or that they should.
Export is a button in Settings that people find once.

## Behaviour

On the dashboard, between the header and the stat grid, and only when the
inventory is not empty (the empty dashboard already shows its own screen):

- **Quiet line**, always shown while the reminder is on:
  `Last backup: 12 days ago` with a **Back up now** button, or `No backup yet`.
- **Warning banner** instead of the quiet line when a backup is overdue:
  *"Your last backup was 41 days ago. Changes made since then exist only on this
  device."* with **Back up now**. For a user who has never backed up:
  *"You have never made a backup. Everything you have entered exists only on this
  device."*

**Back up now** runs exactly what the Export button in Settings runs, with the
history switch off, then updates the line in place and says which file was made.

In Settings, in the existing Backup card (`BackupPanel`): the same status line,
a switch **Remind me to back up** (on by default) and a choice **Remind me
after** of 7, 14, 30, 60 or 90 days (30 by default, disabled while the switch is
off), and one sentence of advice: *a backup protects you once the file is
somewhere other than this device.*

Switching the reminder off hides both the line and the banner on the dashboard.
The status stays visible in Settings.

## The rule

A pure function decides. Inputs: `enabled`, `thresholdDays`, `now`,
`lastBackupAt`, `earliestDataAt`, `latestChangeAt`, `hasData`.

```
off      the reminder is switched off, or there is no data
         ("no data" is the test the dashboard already uses for its empty
         screen: no items, active or archived)
due      reference age >= thresholdDays
         AND (lastBackupAt is null OR latestChangeAt > lastBackupAt)
recent   lastBackupAt is set and the rule above is not met   -> "Last backup: N days ago"
never    lastBackupAt is null and not yet due                -> "No backup yet"
```

- `reference` is `lastBackupAt`, or `earliestDataAt` when there has never been a
  backup, so a brand-new user is not nagged on day one.
- `latestChangeAt > lastBackupAt` is why somebody who has not touched their
  stock in three months is not pestered: an old backup of unchanged data is
  not a risk. The quiet line still says how old it is.
- Age is whole elapsed days, `floor((now - reference) / 86 400 000)`, never
  negative. A `lastBackupAt` in the future (a clock set backwards) counts as
  age 0 and cannot make the warning appear.
- An unparseable stored date is treated as `null`.

`earliestDataAt` is the smallest `created_at` and `latestChangeAt` the largest
`updated_at` across `items`, `locations` and `contacts`. A quantity change
updates the item, so it counts.

## Where the time lives

**One new setting in the existing `settings` table. No migration.**

| Key | Type | Default |
|---|---|---|
| `lastBackupAt` | ISO-8601 instant or `null`; an unparseable value falls back to `null` | `null` |
| `backupReminderEnabled` | boolean | `true` |
| `backupReminderDays` | integer 1 to 365 (the UI offers 7, 14, 30, 60, 90) | `30` |

Alternative rejected: a `backup_log` table with a row per export. It would give
a history nobody asked for and costs a migration.

### Backups carry settings, so this is handled on purpose

`buildBackup` copies every settings row into the file, and `applyImport`
upserts every key in the file, in merge and replace mode alike. Two
consequences are designed for rather than left to chance:

1. **Export stamps the file with its own time.** `ExportOptions` gains
   `stampLastBackupAt?: string`. When given, `buildBackup` sets
   `settings.lastBackupAt` to it *before* the data is assembled, so the checksum
   (which covers `data`) is correct. A backup restored onto a new phone then
   says, truthfully, that the data was backed up at that moment.
2. **Import keeps the newer time.** For the key `lastBackupAt` only,
   `applyImport` compares the stored value with the file's and keeps the later
   one. Importing an old file can never move "last backup" backwards. Files made
   before this feature simply do not contain the key.

## Keeping the API key out of backups

Decided with the owner on 2026-11-07, and part of this work. The reminder and
the Export button exist to get people to copy a backup file to a USB stick or
cloud storage, and today that file contains the Anthropic API key in plain text
(see the note at the end). So:

- `src/domain/settings.ts` exports `DEVICE_ONLY_SETTING_KEYS = ['anthropicApiKey']`.
- `buildBackup` skips those keys when it copies settings.
- `applyImport` skips those keys when it applies settings, in merge and replace
  mode, so even a backup made by an earlier version that contains a key can no
  longer overwrite the receiver's. An existing key is left exactly as it was.
- Settings says so, in the Backup card: *"Your Anthropic key is never included in
  a backup. After restoring on another device, enter it again in Settings."*
- `aiEnabled` is not excluded. Without a key it does nothing, and it is not a
  secret.

The checksum is unaffected: it covers `data` as built, and an older file's
checksum still verifies because import recomputes it over `data` as received
and only then skips the key.

Cost accepted: a restore no longer brings the key back. Anyone who stored an
earlier backup file should treat the key in it as exposed; the changelog says so.

## Pieces

| Unit | Purpose | Depends on |
|---|---|---|
| `src/domain/backup-reminder.ts` | `evaluateBackupReminder(input)`, `daysBetween`, `newerInstant`. Pure. | nothing |
| `src/domain/settings.ts` | the three keys above, and `DEVICE_ONLY_SETTING_KEYS` | zod |
| `src/repositories/backup.repository.ts` | `dataSpan(): { earliestAt, latestChangeAt }`, one query over three tables | `SqlDriver` |
| `src/services/backup/run-export.ts` | `exportBackupToDevice({ db, updateSettings, includeTransactions })`: stamp, serialize, download, then `updateSettings({ lastBackupAt })`. Returns the filename. | export service, `downloadText` |
| `src/services/backup/export.service.ts` | `stampLastBackupAt` option; skips device-only keys | `DEVICE_ONLY_SETTING_KEYS` |
| `src/services/backup/import.service.ts` | keep-the-newer rule for `lastBackupAt`; skips device-only keys | `newerInstant`, `DEVICE_ONLY_SETTING_KEYS` |
| `src/features/dashboard/BackupReminder.tsx` | the line and the banner | the above, `useApp`, `useAsyncData` |
| `src/features/settings/BackupPanel.tsx` | switch, day choice, status, advice; its Export button calls `exportBackupToDevice` | |
| `src/app/bootstrap.ts` | expose `repositories.backup` | |
| `src/i18n/locales/{en,pt-BR,es}.ts` | new `backup.*` keys | |

`BackupPanel`'s export code moves into `exportBackupToDevice` so the dashboard
and Settings cannot drift apart. The CSV export is untouched and does not count
as a backup: it cannot be restored.

### Order of operations in `exportBackupToDevice`

1. `stamp = nowInstant()`.
2. `serializeBackup(db, { includeTransactions, stampLastBackupAt: stamp })`.
3. `downloadText(...)`.
4. `await updateSettings({ lastBackupAt: stamp })`, which also bumps `revision`
   so the dashboard re-reads.

If steps 2 or 3 throw, nothing is recorded. If step 4 throws, the file exists
but the date was not recorded; the error is shown and the user can press again.

## Wording and honesty

- On Android, JavaScript cannot learn whether the native shell wrote the file to
  Downloads (`MainActivity.java` does that, and tells the web side nothing). The
  application can only know an export was *started*. So the text says "last
  backup", never "you are safe", and the Settings sentence tells people to copy
  the file somewhere else.
- Relative times use `Intl.RelativeTimeFormat(language, { numeric: 'auto' })`
  (`yesterday`, `12 days ago`, `ontem`, `hace 12 días`), so no plural tables are
  needed and all three languages come free. Sentences take the phrase as
  `{when}`.
- The quiet line is a `<p>` with a button. The banner is the existing `Alert`
  with the `warning` tone and no `role="alert"`: it is persistent, not urgent,
  and must not be announced on every render.

## Settings text (English; Portuguese and Spanish go in with it)

`backup.reminderStatus` "Last backup: {when}" · `backup.reminderNever` "No backup yet" ·
`backup.backUpNow` "Back up now" · `backup.overdueTitle` "Your last backup was {when}" ·
`backup.overdueTitleNever` "You have never made a backup" ·
`backup.overdueBody` "Changes made since then exist only on this device." ·
`backup.overdueBodyNever` "Everything you have entered exists only on this device." ·
`backup.reminderSwitch` "Remind me to back up" · `backup.reminderAfter` "Remind me after" ·
`backup.reminderDaysOption` "{count} days" ·
`backup.reminderAdvice` "A backup protects you once the file is somewhere other than this device." ·
`backup.keyNotIncluded` "Your Anthropic key is never included in a backup. After restoring on another device, enter it again in Settings."

The existing translation test fails if any locale lacks a key English has.

## Testing

Tests are written first, as the project does.

1. `evaluateBackupReminder`: every status; the threshold boundary (age
   `threshold - 1` vs `threshold`); changed vs unchanged since the backup; never
   backed up, young vs old data; reminder off; no data; future-dated
   `lastBackupAt`; unparseable `lastBackupAt`; `latestChangeAt` null.
2. `newerInstant` and `daysBetween`: ordering, equal values, invalid input.
3. Settings: the three defaults; a bad `lastBackupAt` falls back to `null`
   without losing other settings.
4. `buildBackup` with `stampLastBackupAt`: the key is in `data.settings` and the
   checksum verifies on re-import; without the option nothing changes.
5. `applyImport`: a file with an older `lastBackupAt` does not move it back; a
   newer one moves it forward; a file without the key leaves it alone. Both
   modes.
6. `dataSpan`: empty database; changes on each of the three tables.
7. `exportBackupToDevice`: records the stamp after a download; records nothing
   when serialising throws.
8. `BackupReminder` component: line, banner, never-backed-up banner, hidden
   when off or empty, **Back up now** updates the line.
9. The API key: a backup built from a database with a key set contains no
   `anthropicApiKey`; importing a file that does contain one (an old backup)
   leaves an existing key untouched and does not create one; `aiEnabled` still
   round-trips; the file's checksum still verifies.

Then the project's own standard: `npx tsc --noEmit`, `npx eslint .`, `npm test`,
`npm run build` (including the offline audit), `npm run smoke`. And a
**measured** check in a real browser at phone and desktop width of both states:
positions and text read back from the rendered page, not assumed from the code.

## Documentation

`README.md` ("Backup and restore" gains a paragraph on the reminder and one
saying the key is never in a backup) and `docs/CHANGELOG.md` (an entry for this
change, under a heading that does not claim a version number until one is
released). The changelog entry tells anyone who stored a backup made by an
earlier version that it contains their key, and that replacing the key is
prudent. The README also says "two permissions" where the build checks for
three; that is wrong, outside this feature, and left alone unless asked. Both
lists in the README that say what is not built stay accurate.

## Not built, and said so

- Phone notifications for an overdue backup.
- Automatic or scheduled backups, cloud sync, encryption of the backup file.
- A "remind me later" button. The Settings switch is the way out.
- Any version bump, commit, tag or release. Those happen when asked.

## Why the key is handled here

**Backup files contained the Anthropic API key in plain text.** `buildBackup`
copies every settings row, and `anthropicApiKey` is one. Confirmed by building a
backup from a test database with a key set: the file contains the key and
`aiEnabled: true`. Nothing in the interface says so; the only warning about the
key concerns debug builds. On the import side, any backup overwrites the
recipient's `anthropicApiKey` and `aiEnabled`, so a file received from someone
else silently changes which key the application uses.

This matters here because this feature, and the existing Export button, exist to
get people to copy that file to a USB stick or cloud storage. The owner chose,
on 2026-11-07, to fix it as part of this work: see "Keeping the API key out of
backups" above.

## Risks

| Risk | Handling |
|---|---|
| Import overwrites `lastBackupAt` with an older value | Keep-the-newer rule, tested in both modes |
| The checksum no longer matches after stamping | The stamp is applied before the data object is built; a round-trip test verifies it |
| Android export succeeds in JavaScript but the native write fails | Cannot be detected from the web side; wording never claims safety |
| Double tap on **Back up now** | The button is disabled while an export runs, as in `BackupPanel` |
| A nagging banner nobody can silence | The Settings switch, off in one tap |
| Dashboard becomes slower | One query, two aggregates over three small tables; timed on a 1 500-item stock on the in-memory driver (the plan's last task) |
