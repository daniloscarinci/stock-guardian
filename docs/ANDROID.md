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

Then run the same check the workflow runs. It should print exactly three lines,
in this order, and nothing else:

```bash
aapt2 dump permissions android/app/build/outputs/apk/debug/app-debug.apk   | grep '^uses-permission:' | cut -d"'" -f2 | grep -v '^app.stockguardian.android.'
```

```
android.permission.INTERNET
android.permission.RECORD_AUDIO
android.permission.POST_NOTIFICATIONS
```

Any fourth line is a failure. The workflow allows those three names and rejects
every other, and the section below says why there are three at all. Speaking is
not among them: `TextToSpeech` asks the system for nothing.

To see the check bite, add `<uses-permission
android:name="android.permission.CAMERA" />` to the manifest, rebuild, and run
it again: `android.permission.CAMERA` appears, the workflow step exits 1. Then
take it out.

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

The application code is identical. Six things around it are not.

**No service worker.** On the web, a service worker makes the site work offline.
Inside the APK every asset already sits on the device, so a second cache would
add nothing, and it could serve the previous version's files after an update
because a service worker updates on its own schedule. `VITE_TARGET=android`
therefore drops it from the build. The APK is the offline mechanism on Android;
the service worker is the offline mechanism on the web.

**It asks the system for three permissions, and it used to ask for none.** Every
one of the three is worth explaining rather than noticing, and each was added one
at a time against a check that would otherwise have failed the build.

`android.permission.INTERNET` is there because the AI assistant reaches
`api.anthropic.com` with a key the user pastes into Settings. Android offers
nothing narrower: no per-host permission, no way to hold one only while a
feature is switched on, and no way for a WebView to make that one request
without it. Leave the key blank and nothing uses it — the application still
opens no connection, and the first launch still works with the radio off,
because every asset is inside the package.

`android.permission.RECORD_AUDIO` is there because the microphone is, and the
paragraph below on the microphone is the whole argument for it. It is requested
at runtime on the first press of the microphone, never at startup, so somebody
who opens this application to read what is in the pantry is never asked about
it.

`android.permission.POST_NOTIFICATIONS` is there because the expiry reminders
are. From Android 13 nothing may post a notification without it. It is requested
at runtime the first time somebody switches the reminders **on** in **Settings →
Expiry reminders**, never at startup, and that switch ships off — so a person who
does not want to be interrupted is never shown the prompt and never holds the
permission.

**Three more were merged in by the notifications plugin and taken back out**, and
that is worth reading before deciding this list is short by luck.
`@capacitor/local-notifications` declares four permissions in its own manifest,
not one. `AndroidManifest.xml` strips three of them with `tools:node="remove"`:

| Permission | Why it is not here | What it costs |
|---|---|---|
| `SCHEDULE_EXACT_ALARM` | Every reminder is scheduled as an **inexact** alarm (`isExactNotification: false`). Left at the plugin's default the first schedule would open Android's *Alarms & reminders* settings screen — a second permission screen, for a digest about tinned food. | A reminder set for 09:00 may arrive at 09:04. |
| `RECEIVE_BOOT_COMPLETED` | The plugin registers a receiver that re-registers pending alarms after a restart. Without the permission it is never delivered to. | **A reboot loses the pending reminders until the app is next opened**, which recomputes and reschedules all of them. This is the one real cost of the short list. |
| `WAKE_LOCK` | Nothing in the plugin takes a wake lock. `RTC_WAKEUP` alarms wake the device through the alarm manager's own lock. | Nothing observable. |

`VIBRATE` is not merged in and is not wanted: the notification channel is created
without vibration, because a buzz is not worth a fourth permission. Reminders
still arrive on a sleeping phone — the schedule sets `allowWhileIdle`, which
fires during Doze and needs no permission at all.

The check that used to prove the APK asked for nothing was narrowed rather than
deleted, three times. It allows `android.permission.INTERNET`,
`android.permission.RECORD_AUDIO` and `android.permission.POST_NOTIFICATIONS`,
allows names in this application's own namespace, and fails the build on every
other permission: `CAMERA`, location, contacts, storage, the three stripped
above, and whatever a future library brings with it. Delete those
`tools:node="remove"` lines and the build fails, which is how they are kept
honest. Open **Settings → Apps → Stock Guardian → Permissions** and you should
find the microphone, notifications, and nothing you did not expect. "It asks for
the network, the microphone and permission to notify you, and nothing else" is a
weaker sentence than the one it replaced, and it is still checked by a machine on
every build rather than asserted here.

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

**The microphone asks for `RECORD_AUDIO`, and this page used to promise it never
would.** That promise was kept for four releases and it is worth setting out why
it was made, because the reasoning was sound and the outcome was a dead button.

`SpeechPlugin` used to fire `ACTION_RECOGNIZE_SPEECH`. Google's own voice search
screen opened, the system held the microphone, this application was handed a
sentence, and no audio stream was ever opened here — so there was nothing to ask
permission for, and the build's check proved it on every push. That is a better
design than the one below on every axis except the one that matters.

On a **moto g35 5G**, the phone this application is built for, that Intent
answers *"Voice search isn't available"*. The component behind it — Google Voice
Search — is not available on the device. Four releases went into that wall,
including the online retry added in 2.2.1, which knocked on the same door.

What ended the argument was the keyboard. **Gboard's voice typing works
perfectly on the same phone**, which means the device can transcribe and is
simply refusing the shape of the request. Gboard does not fire that Intent; it
binds the recognition service directly, through `SpeechRecognizer`. So
`SpeechPlugin` does that now — and `SpeechRecognizer` records in this process,
which is what `RECORD_AUDIO` is for. The user was asked, and accepted the
permission, in order to have a microphone that works.

Three things follow, and all three are in the code rather than in this
paragraph:

- **It is asked for on the first press and never at startup.** Capacitor's
  `requestPermissionForAlias` raises the system prompt from `listen` itself.
- **A refusal is an outcome, not an error.** Refuse once and the sheet says the
  permission was not given and the next press will ask again. Refuse twice and
  Android stops asking, so the panel says so and offers this application's own
  page in Settings, which is the only thing that can undo it. An application
  that kept prompting into that void would be a control with an animation and no
  effect.
- **The error codes are the prize.** `RecognitionListener.onError` delivers the
  real constants, including `ERROR_LANGUAGE_UNAVAILABLE` and
  `ERROR_LANGUAGE_NOT_SUPPORTED` — the two that name a missing offline model and
  could never reach an `Intent` result. The timing heuristic that used to guess
  a refusal from how quickly `RESULT_CANCELED` came back is deleted.

`SpeechRecognizer` must be created, started and destroyed on the main thread,
and a Capacitor plugin method does not run there. Getting that wrong produces a
silent failure indistinguishable from the bug above, so every touch of a
recognizer in `SpeechPlugin` goes through a main-looper handler, and one exit
path destroys it on results, on errors, on a cancel and on the activity going
away. A leaked recognizer holds the microphone open.

**The plugin still does not decide whether to stay offline.** `listen` takes
`preferOffline` and does as it is told; the web layer owns the sequence, in
`src/services/speech/capacitor.ts`, where it can be tested without a phone in
the room. Every press calls it once with `true`: on API 33 and up that binds
`createOnDeviceSpeechRecognizer` — the same on-device service the keyboard uses,
which cannot reach a network at all — and elsewhere it is
`createSpeechRecognizer` with `EXTRA_PREFER_OFFLINE`. If that fails and the
phone reports a connection, it calls once more with `false`, and the default
recognition service transcribes over the network — on most phones, through
Google. The exchange is then marked *Transcribed online* in the sheet.

The second attempt is now aimed rather than sprayed. It runs after a missing
language pack, a network or server error, or a recognizer that could not bind;
it does not run after a silence, a cancel, or a refused microphone, because a
retry is a fresh recording and those are not failures a second service could
fix. **Settings → Ask → Transcribe on this device only** removes it entirely,
and is off as shipped. `docs/VOICE.md` sets out how each failure is named.

**There is a stop button while it listens, and it replaces something the system
used to provide.** The recognizer's screen had a back button. A bound service
shows nothing at all, so without one a press made by mistake would hold a
microphone this process is now the one holding.

**The manifest carries a `<queries>` element, and it is not a permission.** From
Android 11 an application sees no other application it has not named, so without
it `SpeechRecognizer.isRecognitionAvailable` reports nothing and the bind that
follows would fail — the microphone would report itself unavailable on every
modern phone. It names `android.speech.RecognitionService` for that, and
`android.intent.action.TTS_SERVICE` so the speech engine can be found for the
same reason. The activity action `android.speech.action.RECOGNIZE_SPEECH` was in
there too and came out with the Intent that used it. It grants no capability and
is not `QUERY_ALL_PACKAGES`, which is a permission and is not there. The build's
permission check still finds `INTERNET`, `RECORD_AUDIO` and
`POST_NOTIFICATIONS`, and nothing more.

**`TtsPlugin` is why the application can speak at all.** Reading answers aloud
used `speechSynthesis` and, inside the APK, read nothing: **Android's WebView
exposes the Web Speech synthesis API without implementing it.** The object is
there, so every check passed; `getVoices()` returned an empty list, so the voice
menu in Settings never appeared; `speak()` accepted every sentence and played
silence; and no error was raised anywhere. That is the microphone's bug in a new
costume, and it has the microphone's fix — `TtsPlugin` binds
`android.speech.tts.TextToSpeech` directly.

It asks the system for nothing: `TextToSpeech` needs no permission, and the
build's check proves that rather than this paragraph. What it did need is one
more line in `<queries>`. From Android 11 an application cannot see an engine it
has not named, and the default engine lives in another package — usually
`com.google.android.tts` — so without `android.intent.action.TTS_SERVICE` the
bind fails, `onInit` reports an error, and the phone is silent. Like the
recognition service above it, that is package visibility rather than a
permission: it grants nothing, and it is not `QUERY_ALL_PACKAGES`.

Two things in that plugin are worth knowing about. **Initialisation is
asynchronous**, and `speak` called before `onInit` succeeds plays nothing and
says nothing — the failure being fixed — so every call is parked until the engine
answers rather than fired at one that is not ready, and an engine that never
answers is given up on after five seconds and reported. And **`shutdown()` runs
when the activity is destroyed**, because a leaked engine holds a bound service
and an audio focus handle.

**`RingerPlugin` is the other half of the sound.** One method, `isSilent`,
reading `AudioManager.getRingerMode` so that an answer read aloud does not talk
over a phone somebody has deliberately silenced. It records nothing, opens
nothing, and needs no permission either. It was part of `SpeechPlugin` once,
survived that plugin's deletion because the speaker could not do without it, and
stayed separate when the microphone came back.

`docs/VOICE.md` covers the ask box itself — both ways into it, what it will not
do, and the sentence the application says when it opens.

**Expiry reminders are scheduled ahead, and nothing runs in the background.**
This is the difference between what this feature is and what people assume a
reminder is, so it is set out rather than implied.

A Capacitor WebView cannot wake up. There is no worker running while the
application is closed, no weekly job, nothing that could look at the database on
a Tuesday and decide what to say. So every notification's text is decided **in
advance** — on a day the application happens to be open — and handed to Android's
alarm manager with the date it should appear. `src/services/notifications/plan.ts`
does the deciding and it is pure, which is why it can be tested without a phone.

What follows from that, in both directions:

- A phone left untouched for three months still delivers every reminder that was
  planned on the last visit. The sentences were already written and the alarms
  were already set.
- An item added, or a date changed, on another device is invisible until this
  application is opened. Opening it recomputes the whole plan from the current
  inventory and replaces the pending set.
- The plan is recomputed on start-up and after every write, because it is keyed
  to the same "something changed" counter every screen re-reads on.

Two notifications per expiry date at most: one at the user's **first** warning
window (the smallest of `expiryWarningDays`, 7 by default) and one on the day
itself. Everything sharing a date is one notification naming at most three items
and counting the rest — the same rule a spoken answer follows, and literally the
same function. At most **40** are pending at once; Android stops accepting
alarms silently somewhere around fifty, so the cap is well under it and drops the
furthest away, never the soonest.

Ids live in a band of this application's own (`811000000` upward) so that
rescheduling cancels exactly what it scheduled last time and nothing else. A
reschedule cancels before it schedules, which is what stops eleven copies
building up over eleven openings.

### What can stop a reminder arriving

Listed rather than left to be discovered, because a reminder that does not come
looks identical to a reminder that was never set.

- **The permission was refused, or revoked later.** Settings says so next to the
  switch, and offers the app's own settings page once Android has stopped
  asking. Nothing is scheduled meanwhile.
- **Notifications are off for the app or for the channel.** Android lets someone
  silence *Expiry reminders* on its own screen without touching this
  application. The plugin refuses the schedule outright in that case and the
  refusal is reported.
- **The phone was restarted.** Pending alarms do not survive a reboot and this
  build does not hold `RECEIVE_BOOT_COMPLETED` to restore them. Opening the
  application reschedules everything.
- **The application was force-stopped, or the launcher's battery optimiser put
  it to sleep.** Android cancels alarms for a force-stopped package until the
  application is opened again. Some manufacturer builds — Xiaomi, Oppo, Vivo and
  Huawei in particular — are aggressive about this; their "autostart" or
  "protected apps" list is where it is undone.
- **It has been more than 40 notifications' worth of dates since the last
  opening.** The cap keeps the soonest, so this only ever removes reminders far
  in the future, and opening the application restores them.
- **The delivery time already passed today.** A reminder is never scheduled for
  a moment that has gone, because an alarm set in the past fires immediately.
- **Doze delays it.** Inexact alarms are permitted to slip; `allowWhileIdle`
  keeps that to minutes rather than hours, and it is the reason the exact-alarm
  permission is not needed.
- **The date changed on another device.** Nothing runs while the application is
  closed. The plan is only as current as the last time it was opened.

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
install is the first real test. Check eleven things in order, because each one
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
8. **The microphone asks once, then works.** Press it in the sheet. The first
   press of the first run raises Android's microphone prompt — that is the only
   time it appears, and it must not appear at startup. Allow it and say the same
   thing. With an offline Portuguese pack installed you get an answer and no
   marker, because nothing left the phone. Without one there is a pause while
   the second attempt runs, and the answer carries *Transcrito pela internet*.
   No screen of Google's opens at any point now; the *Ouvindo…* line and the
   stop button beside it are the whole of the interface while it listens.

   Turn the radio off and try again: you should get the panel naming the missing
   pack and the way to install it, never a button that does nothing. Then switch
   **Settings → Ask → Transcribe on this device only** on and confirm the second
   attempt stops happening.

   Now check the refusal, because it is a first-class outcome and it is new.
   Revoke the microphone in **Settings → Apps → Stock Guardian → Permissions**
   and press it again: Android asks, refuse, and the sheet should say the
   permission was not given and that the next press will ask once more. Refuse a
   second time and Android stops asking — the sheet must then say so and offer
   **Abrir as configurações do aplicativo**, never a prompt that does not
   appear. Typing works throughout.

   That permissions screen should list the microphone and nothing you did not
   expect. It did not list it before this release, and `docs/VOICE.md` and the
   microphone section above explain why that changed. The network permission is
   still the assistant's alone: the second attempt travels on the recognition
   service's own connection, not on this application's.
9. **Answers are read aloud, and the silent switch stops them.** Leave
   **Settings → Ask → Read answers aloud** on, ask a question, and listen. This
   is the check that failed silently for every release before this one: the
   answer appeared as text and the phone said nothing. Then put the phone on
   silent and ask again: `RingerPlugin` reads the ringer mode, and the phone's
   own switch wins over the setting.

   Check the two things that could not work before, either. **Settings → Ask →
   Which voice** should now list the voices this phone actually has, with names
   like `pt-br-x-afm#female_1-local` and a *Feminino* or *Masculino* label on the
   ones that say so — that menu has never appeared on a phone until now, because
   the list behind it was always empty. And **Ouvir** should read one real
   sentence. If it stays quiet it must say why: silent switch, or no engine for
   this language.

   Then close the application and open it again. It should say good morning —
   or boa tarde, or boa noite — and then what needs doing, once, and never again
   as you move between screens. **Settings → Ask → Falar comigo ao abrir o
   aplicativo** switches it off.
10. **The assistant is off, and stays off.** With no key pasted, ask something the
   twelve rules do not know and confirm the answer is "I did not understand
   that" with examples - not a network error, and not a pause while something
   times out. Nothing should leave the phone until a key is stored and
   **Settings → Ask Claude** is switched on.
11. **Nothing asks about notifications until you ask for them.** Open the
   application, use it, close it. Android must never raise a notification
   prompt on its own — the permission belongs to one switch.

   Now turn it on: **Settings → Expiry reminders → Remind me before things
   expire**. Android asks once. Allow it, and the line under the switch should
   say how many reminders are set — one per warning day and one per expiry day,
   so an inventory with three dated items and no duplicates says six. Add an
   item expiring tomorrow with the delivery time set a few minutes ahead and
   wait: the notification should carry the count and the deadline in your
   language, and tapping it should land on the **expiration centre**, not the
   dashboard.

   Then check the refusal, which is a first-class outcome here as it is for the
   microphone. Switch it off, revoke notifications in **Settings → Apps → Stock
   Guardian → Notifications**, and switch it on again: Android asks, refuse, and
   the panel should say the permission was not given and that switching it on
   again will ask once more. Refuse until Android stops asking and the panel must
   change to the one offering **Open app settings**, never a prompt that does not
   appear.

   Finally, the permissions screen should list the microphone and notifications
   and nothing else — in particular no **Alarms & reminders** entry, which is
   what the `SCHEDULE_EXACT_ALARM` removal above is for. Restart the phone and
   the pending reminders are gone until you open the application again; that is
   expected, and the table above says why.

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
from git — including the `queries` element, `allowBackup="false"`,
`RECORD_AUDIO`, `POST_NOTIFICATIONS`, the three `tools:node="remove"` lines and
the `xmlns:tools` declaration they need, and the long comment explaining why
those three permissions are here and no others. The template's own `INTERNET` line happens to be the one
thing it gets right now, which is a poor reason to trust the rest of it.

---

## Minimum requirements

Android 7.0 (API 24) or later, with Android System WebView at Chrome 108 or
later. The WebView requirement is the real one, and it updates through the Play
Store on its own.
