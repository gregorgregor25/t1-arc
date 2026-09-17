# T1 Arc regional connection test matrix

T1 Arc separates the device region from the service region that owns a source
account. Travelling must never silently move a saved LibreLinkUp, Dexcom,
Medtrum or Glooko account to another service.

## Automated on every change

| Layer | Europe | United States | Japan | Other |
| --- | --- | --- | --- | --- |
| Locale, timezone and glucose-unit defaults | Required | Required | Required | Required |
| LibreLinkUp initial host and verified redirect | `.io` plus redirect | `.us` plus redirect | `.io` plus redirect | `.io` plus redirect |
| Dexcom Share service selection | International | US | Japan | International |
| Medtrum service selection | EU or France | Explicit user choice | Explicit user choice | Explicit user choice |
| Glooko endpoint contract | EU hosts | US hosts | Not advertised | Not advertised |
| Glooko archive/date parsing | Fixture verified | Fixture/contract verified; experimental live beta | Not advertised | Not advertised |
| Calendar/DST boundaries | London/Berlin | New York/Chicago | Tokyo | Representative IANA zone |

The automated suite uses fake credentials and local HTTP fixtures. It verifies
request hosts, redirects, response parsing, authentication failures, timezone
boundaries and that unsupported live imports fail before personal data can be
written.

## Emulator matrix

Run the current release candidate with these locale/timezone combinations:

- `en-GB` / `Europe/London` / mmol/L
- `de-DE` / `Europe/Berlin` / mmol/L
- `fr-FR` / `Europe/Paris` / mmol/L
- `en-US` / `America/New_York` / mg/dL
- `ja-JP` / `Asia/Tokyo` / mg/dL
- `en-AU` / `Australia/Sydney` / explicit unit choice

For each combination verify Settings labels, automatic defaults, manual
overrides, date presentation, graph day boundaries and that changing timezone
does not mutate an already saved source region.

## Implementation versus field evidence

Automated mocks prove T1 Arc's behaviour but cannot prove a third-party service
still returns the same production schema. Public documentation and corroborated
open-source contracts are sufficient to implement and label a beta route. The
following evidence promotes a route from experimental to field-tested; it is
not a prerequisite for leaving the safe beta implementation available:

1. A sanitised export fixture from a real account in that region.
2. Proven date order, timezone semantics, units and DST behaviour.
3. A successful end-to-end report from a user in that region.
4. A safe diagnostic showing only region, result category and timestamps - never
   credentials, account identifiers or health values.

A VPN is not a substitute: the account's home service, rather than the phone's
current IP address, determines the production region.

Reports use `.github/ISSUE_TEMPLATE/regional-compatibility.yml`; contributors
must omit credentials, account identifiers, raw exports and personal health
values.
