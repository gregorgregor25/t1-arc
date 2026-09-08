# T1 Arc Wear architecture

## Packages

- `:app` - the existing Android phone app.
- `:wear` - the Wear OS companion, complication data source, and Tile.
- `:watchface-meridian` - the resource-only Watch Face Format package.
- `:watchface-chronograph` - the resource-only Chronograph package.
- `:watchface-atelier` - the resource-only refined analogue face.
- `:watchface-pace` - the resource-only sports digital face.
- `:watchface-summit` - the resource-only field-watch hybrid.
- `:watchface-push` - five variants bundled into the companion's one-slot catalog.

Orbit is retired from active builds. Its source and complication provider are
kept for compatibility with existing installations, not distributed as a sixth face.

The phone and companion intentionally use the same application ID and signing
certificate. Wear OS Data Layer enforces both before it allows them to exchange
data. Each watch face has its own package because Watch Face Format bundles
cannot contain application logic.

### Moving between phone installations

Two phone apps can both be labelled T1 Arc without sharing their watch
connection. The official, `.sideload` private-test and `.dev` debug packages are
separate installations. An older personal package is separate too. A matching
certificate is not enough if the package names differ.

Use the phone and companion APKs from the same release. The shared Gradle
identity and signing policy keeps them aligned. Watch-face builds also target
the companion for that variant. An existing face's selected complication can
still point to an older companion and may need to be selected again.

Before retiring another phone installation:

1. Back up the intended phone app. Compare its package and signer with the
   update APK, then update that installation without clearing its data.
2. Inspect the installed watch companion's package and signer. Update it in
   place only when both match; a different package is a separate installation.
   Do not rename packages or remove data just to bypass an install error.
3. Open the matching companion and use **Check watch connection** under Wear
   OS in the new phone app. A queued reading is not proof the watch displayed it.
4. With the older phone app stopped, verify new measurement timestamps reach
   the companion, tile and selected complication. Check phone-screen-off
   operation, disconnect/reconnect and the delayed/stale indication.
5. Remove the old installation only after confirming the independent connection
   and preserving any records that exist only in that app.

The APK verifier checks the actual phone/companion application IDs and signing
certificates. That is a compatibility check, not a physical-device sync test.

## Data path

```text
LibreLinkUp source
  -> encrypted phone history
  -> normalised glucose display snapshot + six-hour graph payload
  -> Wear OS Data Layer
       /t1arc/v1/glucose/current
       /t1arc/v1/glucose/history
  -> encrypted watch cache
  -> companion app, graph, Tile, and T1 Arc complication
  -> Meridian, Chronograph, Atelier, Pace and Summit watch faces
```

Only normalised display data crosses the Data Layer. The current payload
contains canonical mmol/L, trend and origin, measurement time, non-secret
source label, source error flag, range/colour presentation tokens, selected
glucose unit, locale and IANA timezone. The history payload contains at most
144 timestamp/value pairs and no account or source identifiers. Credentials
and LibreLinkUp session tokens never leave the phone. The Data Layer can route
over Bluetooth or end-to-end encrypted cloud relay when Bluetooth is
unavailable.

The Message Client is the immediate route while the watch is connected. Urgent
retained Data Items are the recovery route after disconnects, restarts, or a
fresh companion installation. The watch requests both current and historical
payloads whenever its companion or graph opens.

## Freshness contract

- Current: measurement age up to 6 minutes.
- Delayed: over 6 and up to 12 minutes.
- Stale: over 12 minutes.
- Missing: no usable measurement.

The source error flag remains separate diagnostic metadata. A failed refresh
does not make a still-current measurement look delayed.

The complication supplies a platform timeline so it becomes delayed and then
stale even if neither app is running. The Tile and companion calculate
freshness from the measurement timestamp whenever they render.

No wearable surface recommends insulin doses or pump-setting changes.
