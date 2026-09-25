# AI provider choice: validation record

This records the provider choice checks performed before the proposed T1 Arc
1.7.12 release. The private phone build was `1.7.12-provider-test.3`, version
code 52. It is not a production APK. The release workflow must verify the
final signed 1.7.12 artifact and its exact source revision separately.

## Model choice

Each provider has its own saved model selection and secure API key. The existing
defaults are retained for installations without a saved model. An unknown saved
model or an API access failure requires an explicit selection; there is no
automatic model or provider substitution. Both answers and evidence planning
use the selected model. Settings link to official pricing instead of displaying
fixed prices or cost labels. No model has a Recommended label in this release.

- OpenAI: `gpt-5.6-luna`, `gpt-5.6-terra`.
- Gemini: `gemini-3.8-flash`, `gemini-3.7-flash`.
- Claude: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5-5`.

Google's current `AQ.` authorization keys and legacy `AIza` keys are accepted
locally. Format validation is not an authentication check.

## Private validation completed on 24 September 2026

- The provider transport, settings, local count route, evidence planner and
  failure handling have automated coverage. The model comparison used synthetic
  questions and records, native provider requests and strict response parsing.
  Local fallbacks were recorded separately from accepted model responses.
- The updated private phone APK installed over the existing app with the same
  signing identity. Existing records and all three saved API keys remained
  available. The owner confirmed the installed watch companion still showed a
  fresh reading, trend arrow and reading age after the phone update.
- On the phone, the exact seven-day **low** glucose event question returned the
  same locally calculated answer with OpenAI Luna, Gemini 3.8 Flash and Claude
  Haiku selected. These were local calculations, not three independently
  generated AI answers. The private result and underlying records are not
  published here.
- Fresh, record-free HbA1c/time-in-range explanations from Gemini 3.7 and 3.8
  were checked. Gemini 3.7 passed the factual review. Gemini 3.8 explained the
  core distinction but used wording that could imply the complete CGM trace
  and variability measurements establish clinical severity. They do not
  establish it without clinical context. The owner accepted this limitation for the
  release. It remains a known limitation, not a general clinical accuracy claim.
- The private synthetic correction comparison accepted eight of eight final
  Gemini education responses across the two Flash models. The 3.8 phone
  limitation above shows why those synthetic results do not guarantee every
  future explanation.

## Final release verification

- Run the repository quality workflow on the intended PR head.
- Confirm the exact signed production build preserves the provider choices,
  secure keys, local counts and existing Wear companion protocol. The private
  phone build and passing older commits cannot stand in for release verification.
- Update the public privacy policy to list Google and Anthropic before enabling
  this in a published app. Review Google's account, billing, age and regional
  terms for the intended audience.
- Keep this as a phone-only change. There are no Wear OS code or protocol changes.
  The bundled companion's build version follows phone packaging metadata, but
  this does not require reinstalling a working companion or watch debugging.
  The owner confirmed a fresh reading, trend and reading age on the installed
  watch after the private phone update. Check release-artifact compatibility.

## Safe phone updates

Inspect the installed application ID, version code and signing certificate.
Create an encrypted backup in the existing app and keep its password
separately before updating. Install only as an update with the matching
certificate and a suitable version code. Never uninstall a populated app or
downgrade its data to make a build install.

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
