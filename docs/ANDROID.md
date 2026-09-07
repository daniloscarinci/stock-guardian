# The Android application

Stock Guardian runs on Android as a real installed application with its own
icon, built from exactly the same source as the website. It is not a shortcut to
a web page. The APK carries the whole application inside it, so the first launch
works with the radio off, the same as the thousandth.

Capacitor supplies the native shell: an activity holding a WebView that loads
the built application from the APK's own assets over `https://localhost`. That
scheme matters more than it looks. The database is SQLite compiled to
WebAssembly, stored in the Origin Private File System, and browsers expose OPFS
only in a secure context. Served over `http`, or opened from a `file://` path,
the application would not start at all.

---

## Building an APK

### Once, on this machine

```bash
npm run generate:android-key
```

That writes `stock-guardian-release.p12` and `android-signing-secrets.txt`, and
commits neither. Open the second file and add the four values it names as
repository secrets, under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The long base64 block |
| `ANDROID_KEYSTORE_PASSWORD` | The generated password |
| `ANDROID_KEY_ALIAS` | `stock-guardian` |
| `ANDROID_KEY_PASSWORD` | The same generated password |

Then back up both files somewhere you will still have in five years. The section
on the signing key explains why that sentence is not boilerplate.

You need no JDK and no Android SDK. Node writes the key, and everything else
happens on GitHub's machines.

### Every time you want an APK

```bash
git tag v2.0.0
git push origin v2.0.0
```

The workflow builds the application, signs it, and attaches the APK to a GitHub
Release named after the tag. It takes a few minutes.

To test a change without minting a version, open the **Actions** tab, choose
**Build Android APK**, and run it by hand. That produces the same APK as a
downloadable artifact and creates no release.

When a signing secret is missing the build stops immediately and says which one.
Signing an APK with the wrong key is worse than not building one.

---

## Installing it

Open the release on the phone itself, download the `.apk`, and tap it. Android
asks for permission to install from an unknown source; grant it. The prompt
appears because the file did not come from the Play Store, which is true.

To install over a cable instead, with the Android platform tools on the
computer:

```bash
adb install -r stock-guardian-2.0.0-1.apk
```

`-r` replaces the installed copy and keeps its data.

---

## Updating

Push a new tag, download the new APK, and open it. Android installs it over the
old one and the database survives, provided the same key signed both.

The version code comes from the workflow run number, so it always increases. The
version name comes from `package.json`, so the application, the site and the
release agree on what version they are.

---

## How the Android build differs from the website

The application code is identical. Four things around it are not.

**No service worker.** On the web, a service worker makes the site work offline.
Inside the APK every asset already sits on the device, so a second cache would
add nothing, and it could serve the previous version's files after an update
because a service worker updates on its own schedule. `VITE_TARGET=android`
therefore drops it from the build. The APK is the offline mechanism on Android;
the service worker is the offline mechanism on the web.

**It asks the system for nothing.** Capacitor's template requests `INTERNET`.
This build does not, because the application makes no network requests and needs
none. Open **Settings → Apps → Stock Guardian → Permissions** and see for
yourself. The build fails if any system permission ever appears in the APK, so
it stays a promise you can check rather than one you have to believe.

One entry does appear in the manifest, and it is not a permission the
application asks for. androidx declares
`app.stockguardian.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — a
permission belonging to this application, which exists so that other
applications cannot reach its broadcast receivers. It grants no capability, asks
the system for nothing, and never appears in front of a user. The build's check
allows that one name and rejects everything else.

**No automatic backup.** `allowBackup` is off. Android's automatic backup would
copy the application's private storage — the whole database — to the user's
Google Drive, which would quietly make the central promise of this project
false. The cost is that a new phone starts empty, and **Settings → Backup →
Export** already covers that, with a file you control.

**The shell saves exports.** Android's WebView has no download manager, so a
blob URL and a synthetic click — how every export here works, and how every
browser handles it — does nothing at all. `MainActivity` supplies the missing
piece: it reads the staged file from the page and writes it to the phone's
**Downloads** folder, then names the folder in a toast. On Android 9 and earlier
it writes to the application's own external files directory instead, because the
public Downloads folder would need a storage permission there and this
application has none.

**Voice control needs no microphone permission.** `SpeechPlugin` starts the
system's own recognizer with `ACTION_RECOGNIZE_SPEECH`. Android opens the
recognizer's screen, records there, and hands back the text; the microphone is
held by the recognizer, never by this application, so there is no `RECORD_AUDIO`
to declare. That is why this route was chosen over the `SpeechRecognizer` API
and over the community Capacitor plugin, both of which require the permission.

The one thing the manifest gained is a `queries` element naming the speech
intents. From Android 11 an application cannot see another it has not named, and
without it the check for "is there a recognizer on this phone" would answer no
on every modern phone and the microphone button would never appear. It is not a
permission, it is not `QUERY_ALL_PACKAGES`, and the build's check confirms as
much: the APK still asks the system for nothing.

---

## The signing key

Android installs an update over an existing application only when both carry the
same signature. Lose the key and there is no recovery, no appeal and no
re-issue: the only way to install a differently signed build is to uninstall
first, and uninstalling deletes the database.

So `stock-guardian-release.p12` is the most valuable file this project produces.
Keep a copy off this machine. `npm run generate:android-key` refuses to
overwrite an existing key for the same reason.

The keystore is PKCS#12 rather than a JKS, and Node writes it rather than
`keytool`, so creating it needs no JDK. Java has read PKCS#12 natively for
years, and it is `keytool`'s own default format now. The workflow runs `keytool
-list` against the decoded keystore before Gradle starts, so a keystore Java
cannot read fails in seconds with a clear message.

---

## What to check on the device

No emulator and no phone took part in producing this project, so the first
install is the first real test. Check six things in order, because each one
tells you something different:

1. **It opens.** A blank screen means the WebView could not start the
   application — the interesting case, and the one most likely to involve the
   missing `INTERNET` permission.
2. **The database opens.** Add an item. "This page cannot store data" means OPFS
   is unavailable, which means the WebView is older than Chrome 108. Update
   **Android System WebView** from the Play Store; it updates independently of
   the Android version, so an old phone is not necessarily an obstacle.
3. **Data survives.** Force-close the application from the recents screen,
   reopen it, and confirm the item is still there.
4. **It works with the radio off.** Turn on airplane mode and use it. Nothing
   should change.
5. **Exports arrive.** Choose **Settings → Backup → Export**, then look in the
   phone's Downloads folder for the `.json` file.
6. **The back button behaves.** It should move back through the screens and
   leave the application from the dashboard.

---

## Rebuilding the Android project from nothing

Prefer `npx cap sync android`, which copies the current web build into the
project and leaves everything else alone. Full regeneration is for the case
where `android/` is deleted:

```bash
VITE_TARGET=android npm run build
npx cap add android
npm run generate:android-icons
```

`cap add` restores Capacitor's template, complete with the stock Android Studio
artwork, an `INTERNET` permission and automatic backup switched on.
`generate:android-icons` replaces the artwork and deletes what it supersedes.
The manifest, `MainActivity.java` and `app/build.gradle` carry the rest of those
decisions and would have to come back from git.

---

## Minimum requirements

Android 7.0 (API 24) or later, with Android System WebView at Chrome 108 or
later. The WebView requirement is the real one, and it updates through the Play
Store on its own.
