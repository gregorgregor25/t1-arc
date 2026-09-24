# AI provider choice: pre-release validation

Private implementation for issue #12. This work does not authorize a merge,
public APK, release or publication. Private build version:
`1.7.12-provider-test.2`, phone version code `50`.

## Model choice

Each provider has its own saved model selection and secure API key. The existing
defaults are retained for installations without a saved model. An unknown saved
model or an API access failure requires an explicit selection; there is no
automatic model or provider substitution. Both answers and evidence planning
use the selected model. Settings link to official pricing instead of displaying
fixed prices or cost labels. No model has earned a Recommended label.

- OpenAI: `gpt-5.6-luna`, `gpt-5.6-terra`.
- Gemini: `gemini-3.8-flash`, `gemini-3.7-flash`.
- Claude: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5-5`.

Google's current `AQ.` authorization keys and legacy `AIza` keys are accepted
locally. Format validation is not an authentication check.

## Ready for device testing

1. Open Tarv1s settings. An existing installation should retain its OpenAI key.
2. Select Gemini or Claude, read the data-use notice and enter a dedicated API key
   on the phone. Do not put keys into chat, issues or screenshots. Gemini testing
   with health records requires a billing-enabled project and applicable terms.
3. Choose a model and save. Saving is local and does not claim authentication
   succeeded. Check the pricing link opens the selected provider's official page.
4. Ask “What does HbA1c mean?” first: this uses no health records. Check the model
   returned a readable explanation without blank messages or truncated JSON.
5. With consent to share the selected records, ask one retrospective question
   and one evidence comparison. Verify the facts against local records and
   inspect the evidence list. Check missing data is still clearly reported.
6. Switch models and providers, save each selection, then restart the app. Keys
   and saved models should remain separate. Cancel an unsaved model change and
   confirm it was not applied. Start a new conversation if previous shared
   context should not go to the new provider.
7. Enter a wrong-format key (local rejection), then a revoked test key (provider
   rejection). Check the API settings shortcut and that the question remains.
8. Test airplane mode and reconnection. Check a failed draft can be retried. Do
   not deliberately generate charges to trigger a quota error; that path has
   mocked coverage. Confirm billing in the provider console.
9. Remove each provider key. Confirm local calculations still work. Use a
   disposable installation to verify privacy erase clears every saved key.

## Before a release

- Run the repository quality workflow on the intended PR head.
- Complete real-key testing for both providers and visual phone QA of settings,
  switching, failure recovery and persistence across app restarts.
- Confirm model access for each account. A model-list response does not prove
  inference quota or reliable output. The private comparison uses synthetic
  cases through the actual answer/planning builders, transport and strict parsers;
  local fallbacks must be reported separately from accepted model responses.
- Update the public privacy policy and setup documentation to list Google and
  Anthropic before enabling this in a published app. Review Google's account,
  billing, age and regional terms for the intended audience.
- Keep this as a phone-only change. There are no Wear OS code or protocol changes.
  The bundled companion's build version follows phone packaging metadata, but
  this does not require reinstalling a working companion or watch debugging.
  Check readings, trends, reading age and stale states with the installed watch.

## Safe private installation

Connect the phone and inspect the installed application ID, version code and
signing certificate. Export a fresh encrypted backup in the existing app and
keep its password separately before updating. Install only as an update with
the matching certificate and a suitable version code. Never uninstall the
populated app or downgrade its data to make a test build install.

## Documentation verified on 24 September 2026

Model IDs and request capabilities were checked against the official
[OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[OpenAI Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking), and
[Claude model](https://platform.claude.com/docs/en/models/overview) documentation.
Gemini Flash 3.7 and 3.8 support LOW thinking. Opus 5.5 has always-on adaptive
thinking; bounded output usage includes its thinking tokens.

Pricing sources:
[OpenAI](https://developers.openai.com/api/docs/pricing),
[Gemini](https://ai.google.dev/gemini-api/docs/pricing), and
[Claude](https://platform.claude.com/docs/en/about-claude/pricing).
These links, rather than fixed product prices, are exposed in settings.

Google's [terms](https://ai.google.dev/gemini-api/terms) distinguish developer
testing from making API clients available to UK, EEA and Swiss users, for which
paid services are required. Unpaid services prohibit sensitive or personal
information, and may use inputs and outputs for product improvement and human
review. Synthetic free-tier development tests do not establish suitability for
real health data in a released app. Age and medical-advice restrictions also
need review before public release. No billing settings are changed by testing.

API contracts: [Gemini](https://ai.google.dev/api/generate-content),
[Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[Gemini data-use terms](https://ai.google.dev/gemini-api/terms).
