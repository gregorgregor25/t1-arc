# Regional compatibility contributions

T1 Arc accepts evidence-based fixes even when the maintainer cannot hold an
account in that country. A public provider document, a reproducible sanitized
fixture, or a well-established open-source implementation can support a beta
adapter. Label field evidence separately from implementation evidence.

## Reports

Use the **Regional compatibility report** issue form. Include the country,
provider/source, app and Android/Wear versions, regional settings, exact steps,
and the expected/actual result. Include only a diagnostic code that T1 Arc
explicitly labels safe to share.

Never post credentials, tokens, email addresses, account identifiers, raw
provider responses, database/backup/export files, exact health readings, or
screenshots with personal health information. Use invented readings when a
reproduction needs a value.

## Pull requests

Regional changes should:

- preserve canonical stored health values and apply units only at presentation
  or a documented provider boundary;
- preserve shipped versioned identifiers when changing them would break
  persisted data or cross-process compatibility;
- route providers by explicit account region rather than device location alone;
- use IANA timezones and test DST/non-DST calendar boundaries;
- fail atomically on incomplete provider payloads and expose non-sensitive
  error codes;
- add source attribution and a reproducible normalizer for bundled datasets;
- include tests for the affected region and prove existing GB behaviour still
  passes;
- label support **experimental** until field evidence exists, without hiding a
  documented implementation merely because field evidence is unavailable.

Implementation evidence is not the same as a translated release, clinical
review, licensed commercial data, production signing, or physical-hardware
validation. Do not claim those without the corresponding evidence.

Useful public contract references include:

- USDA FoodData Central: <https://fdc.nal.usda.gov/api-guide/>
- Japan MEXT food composition tables:
  <https://www.mext.go.jp/a_menu/syokuhinseibun/index.htm>
- Nightscout Connect regional-provider notes:
  <https://github.com/nightscout/nightscout-connect>
- pydexcom regional Share hosts:
  <https://github.com/gagebenne/pydexcom/blob/main/pydexcom/const.py>
- LibreLinkUp API client:
  <https://github.com/DiaKEM/libre-link-up-api-client>
