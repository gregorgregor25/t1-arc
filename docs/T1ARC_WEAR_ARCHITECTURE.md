# T1 Arc Wear architecture

## Packages

- `:app` - the existing Android phone app.
- `:wear` - the Wear OS companion, complication data source, and Tile.
- `:watchface-meridian` - the resource-only Watch Face Format package.
- `:watchface-chronograph` - the resource-only Chronograph package.
- `:watchface-orbit` - the resource-only Orbit package.

The phone and companion intentionally use the same application ID and signing
certificate. Wear OS Data Layer enforces both before it allows them to exchange
data. Each watch face has its own package because Watch Face Format bundles
cannot contain application logic.

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
  -> Meridian, Chronograph, and Orbit watch faces
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
