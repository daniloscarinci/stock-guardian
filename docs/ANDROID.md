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
git tag v2.1.0
git push origin v2.1.0
```

The workflow builds the application, signs it, and attaches the APK to a GitHub
Release named after the tag. It takes a few minutes.

To test a change without minting a version, open the **Actions** tab, choose
**Build Android APK**, and run it by hand. That produces the same APK as a
downloadable artifact and creates no release.

When a signing secret is missing the build stops immediately and says which one.
Signing an APK with the wrong key is worse than not building one.

### Building one locally instead

Not needed to ship, and it produces a **debug-signed** APK, which is a different
identity from the release key — Android will not install one over the other. Its
use is checking the permission gate against a real package without minting a
version:

```bash
VITE_TARGET=android npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

**This needs JDK 21.** Capacitor 8 compiles with `sourceCompatibility 21`, and an
older JDK fails with `invalid source release: 21` after a minute of apparently
healthy output. If `java -version` reports 17, point Gradle at 21 for the one
command rather than changing the machine's default:

```bash
JAVA_HOME=/path/to/jdk-21 ./gradlew assembleDebug
```

Then run the same check the workflow runs. It should print
`android.permission.INTERNET`, on one line, and nothing else:

```bash
aapt2 dump permissions android/app/build/outputs/apk/debug/app-debug.apk   | grep '^uses-permission:' | cut -d"'" -f2 | grep -v '^app.stockguardian.android.'
```

Any second line is a failure. The workflow allows that one name and rejects
every other, and the section below says why there is one at all.

---

## Installing it

Open the release on the phone itself, download the `.apk`, and tap it. Android
asks for permission to install from an unknown source; grant it. The prompt
appears because the file did not come from the Play Store, which is true.

To install over a cable instead, with the Android platform tools on the
computer:

```bash
adb install -r stock-guardian-2.1.0-1.apk
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

The application code is identical. Five things around it are not.

**No service worker.** On the web, a service worker makes the site work offline.
Inside the APK every asset already sits on the device, so a second cache would
add nothing, and it could serve the previous version's files after an update
because a service worker updates on its own schedule. `VITE_TARGET=android`
therefore drops it from the build. The APK is the offline mechanism on Android;
the service worker is the offline mechanism on the web.

**It asks the system for one permission, and it used to ask for none.** That
change is worth explaining rather than noticing.

The application declares `android.permission.INTERNET`, and only because the AI
assistant reaches `api.anthropic.com` with a key the user pastes into Settings.
Android offers nothing narrower: no per-host permission, no way to hold one only
while a feature is switched on, and no way for a WebView to make that one
request without it. Leave the key blank and nothing uses it — the application
still opens no connection, and the first launch still works with the radio off,
because every asset is inside the package.

The check that used to prove the APK asked for nothing was narrowed rather than
deleted. It allows `android.permission.INTERNET`, allows names in this
application's own namespace, and fails the build on every other permission:
`RECORD_AUDIO`, `CAMERA`, location, contacts, storage, and whatever a future
library brings with it. Open **Settings → Apps → Stock Guardian → Permissions**
and you should find that one entry. "It asks for the network and nothing else"
is a weaker sentence than the one it replaced, and it is still checked by a
machine on every build rather than asserted here.

The namespaced entry is not a permission the application asks anyone for.
androidx declares
`app.stockguardian.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — a
permission belonging to this application, which exists so that other
applications cannot reach its broadcast receivers. It grants no capability, asks
the system for nothing, and never appears in front of a user.

What the assistant sends, and what it never sends, is set out in
`docs/OFFLINE.md`. The short version: the question, the rows Claude asked a tool
for, and the answer — never the inventory.

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

**The microphone asks for no permission.** `SpeechPlugin` fires
`ACTION_RECOGNIZE_SPEECH`: the system's own screen opens, the system holds the
microphone, and this application is handed a sentence. It never opens an audio
stream, so `RECORD_AUDIO` is not in the manifest and fails the build if anybody
puts it there.

It sends `EXTRA_PREFER_OFFLINE` unless **Settings → Ask → Use internet
recognition** has been switched on, which is off by default. That flag is why
this feature was once removed: on a phone with no offline pack for the language,
Android's recognizer simply refuses, and it answered *"Voice search isn't
available"* on the Portuguese phone this was built for while the plugin reported
every refusal as a cancellation. `docs/VOICE.md` sets out how each failure is
now named, and where the switch that lifts the flag is offered.

**The manifest carries a `<queries>` element, and it is not a permission.** From
Android 11 an application sees no other application it has not named, so without
it `queryIntentActivities` returns an empty list, and the microphone would
report itself unavailable on every modern phone. It names
`android.speech.RecognitionService` and `android.speech.action.RECOGNIZE_SPEECH`
and nothing else. It grants no capability and is not `QUERY_ALL_PACKAGES`, which
is a permission and is not there. The build's permission check still finds
`INTERNET` alone.

**`RingerPlugin` is the other half of the sound.** One method, `isSilent`,
reading `AudioManager.getRingerMode` so that an answer read aloud does not talk
over a phone somebody has deliberately silenced. It records nothing, opens
nothing, and needs no permission, which the build's check proves rather than
this paragraph. It was part of `SpeechPlugin` once, survived that plugin's
deletion because the speaker could not do without it, and stayed separate when
the microphone came back.

Reading answers aloud uses `speechSynthesis`, which asks the system for nothing.

`docs/VOICE.md` covers the ask box itself — both ways into it, and what it will
not do.

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
install is the first real test. Check ten things in order, because each one
tells you something different:

1. **It opens.** A blank screen means the WebView could not start the
   application. It will not be the network: every asset is inside the APK and
   Capacitor serves them from `https://localhost` without opening a socket.
   Look at the WebView version first.
2. **The database opens.** Add an item. "This page cannot store data" means OPFS
   is unavailable, which means the WebView is older than Chrome 108. Update
   **Android System WebView** from the Play Store; it updates independently of
   the Android version, so an old phone is not necessarily an obstacle.
3. **Data survives.** Force-close the application from the recents screen,
   reopen it, and confirm the item is still there.
4. **It works with the radio off.** Turn on airplane mode and use it. With no
   API key stored — which is how it arrives — nothing should change at all.
5. **Exports arrive.** Choose **Settings → Backup → Export**, then look in the
   phone's Downloads folder for the `.json` file.
6. **The back button behaves.** It should move back through the screens and
   leave the application from the dashboard.
7. **The ask button opens the box.** Tap the speech bubble in the header and
   type *"quanto arroz eu tenho?"*.
8. **The microphone works, or says why.** Press it in the sheet and say the same
   thing. With an offline Portuguese pack installed you get an answer; without
   one you get a panel naming the missing pack, the way to install it, and the
   switch that lets the recognizer use the network — never a button that does
   nothing. Either way, confirm in **Settings → Apps → Stock Guardian →
   Permissions** that the microphone is *not* among what this application holds:
   the system's recognizer holds it. The one permission declared is the network,
   and only the assistant uses it.
9. **Answers are read aloud, and the silent switch stops them.** Leave
   **Settings → Ask → Read answers aloud** on, ask a question, and listen. Then
   put the phone on silent and ask again: `RingerPlugin` reads the ringer mode,
   and the phone's own switch wins over the setting.
10. **The assistant is off, and stays off.** With no key pasted, ask something the
   twelve rules do not know and confirm the answer is "I did not understand
   that" with examples - not a network error, and not a pause while something
   times out. Nothing should leave the phone until a key is stored and
   **Settings → Ask Claude** is switched on.

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
artwork and automatic backup switched on. `generate:android-icons` replaces the
artwork and deletes what it supersedes. The manifest, `MainActivity.java` and
`app/build.gradle` carry the rest of those decisions and would have to come back
from git — including the `queries` element, `allowBackup="false"`, and the long
comment explaining why `INTERNET` is the only permission here. The template's
own `INTERNET` line happens to be the one thing it gets right now, which is a
poor reason to trust the rest of it.

---

## Minimum requirements

Android 7.0 (API 24) or later, with Android System WebView at Chrome 108 or
later. The WebView requirement is the real one, and it updates through the Play
Store on its own.
