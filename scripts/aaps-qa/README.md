# Synthetic AAPS status sender for emulator QA

This fixture sends the **same local status broadcast shape** as AAPS 4.0.0-dev-e
(`info.nightscout.androidaps.status`). It has no pump, sensor, treatment,
network, or dosing capability. It is solely for testing T1 Arc on an Android
emulator. It uses AAPS's package name so Android sender-identity checks can be
tested. **Never install it on a phone used with AAPS or a pump.**

Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and `JAVA_HOME` to installed SDK and
JDK directories. The script requires an explicit `emulator-####` serial, checks
that adb reports a running emulator with Android API 26+, and refuses to
replace any installed `info.nightscout.androidaps` package unless its
`versionName` is the exact synthetic marker `t1arc-synthetic-qa`. It signs with
the project's debug keystore and writes ignored build output under
`.qa/aaps-sender`.

```powershell
./scripts/aaps-qa/build-install.ps1 -EmulatorSerial emulator-5582
```

Add `-BuildOnly` to compile and sign without changing the emulator. The fixture
checks that Android package visibility exposes T1 Arc's exported AAPS receiver
through the same `queryBroadcastReceivers` action AAPS uses. Its manifest also
declares the same `android.intent.action.MAIN` visibility query as the AAPS
build examined for this integration. It sends only to
the T1 Arc **dev** package, and records discovery success or failure without
logging glucose or context values. An older unmarked QA fixture must be
explicitly removed from the emulator before this script can install the marked
version; the script refuses to replace an unmarked package.

Once T1 Arc has selected AAPS on that emulator, send a typed status broadcast
without opening an activity or waking the screen:

```powershell
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
adb -s emulator-5582 shell am broadcast -a info.nightscout.androidaps.qa.SEND -p info.nightscout.androidaps --es glucoseMgdl 122.0 --es glucoseTimeStamp "$timestamp" --es slopeArrow FortyFiveUp --es iob -0.25 --es cob 0
```

The QA receiver parses the command-line strings as the Double and Long types
in AAPS's real status broadcast. It also accepts `--es bolusIob`, `--es
basalIob`, `--es futureCarbs`, `--es deltaMgdl`, `--es avgDeltaMgdl`, `--es
units`, and `--ez shareIdentity true` for sender-UID checks. AAPS reports COB
`-1` when unavailable; use `--es cob -1` to test that state. The fixture does
not simulate sensor Bluetooth, pump operation, real AAPS calculations, or
offline watch delivery.
