# AI provider choice: validation record

This records earlier provider choice checks performed for the 1.7.12 candidate
and later private phone validation. The original comparison build was
`1.7.12-provider-test.3`, version code 52. The 1.7.14 ChatGPT connection has
record-free private phone validation; the corrected 1.7.15 candidate's personal
data answers and verification on the exact public APK are separate release
checks.

## Model choice

Each API-key provider has its own saved model selection and secure key. ChatGPT
is a separate, optional plan connection with an account-specific model list;
it does not use or silently fall back to an API key. The existing API defaults
are retained for installations without a saved model. The owner's usual API
choice is OpenAI `gpt-5.6-luna`; the temporary Gemini selection during testing
was not their default. An unavailable saved model or API access failure requires
explicit action. Both answers and evidence planning use the selected model.
Settings link to official pricing instead of displaying fixed prices or cost
labels. No model has a Recommended label in this release.

- OpenAI: `gpt-5.6-luna`, `gpt-5.6-terra` and `gpt-6.1-sol` in the candidate source.
  A record-free HbA1c/time-in-range question completed through the
  saved OpenAI API key on the owner's phone using private candidate
  `1.7.14-private.2` on 4 October 2026. This checks one inference and the guarded
  answer path, not general model accuracy. The default remains Luna.
- Gemini: `gemini-3.8-flash`, `gemini-3.7-flash`.
- Claude: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5-5`.

Google's current `AQ.` authorization keys and legacy `AIza` keys are accepted
locally. Format validation is not an authentication check.

## ChatGPT and OpenAI private phone validation on 4 October 2026

The signed, production-package `1.7.14-private.5` phone build (code 66, source
`8177e59`) installed over the existing app without removing data. The owner's
ChatGPT account listed five plan models and did not offer GPT-6.1. Using an
account-offered Luna model, Tarv1s completed a record-free HbA1c/time-in-range
answer and displayed **General explanation · No personal records used**. This
was a ChatGPT plan request, with no API-key fallback. The strict stream path
required a completed terminal response and assembled completed assistant
messages before the existing answer checks. It verifies one live answer, not
general accuracy or all plan-limit conditions.

During Codex-led QA, sign-out showed a successful revocation notice and explicit
browser sign-in cancellation completed. Returning-account reconnect then
succeeded through Edge using the saved account, including the **Return to T1 Arc**
link and Android's normal Open confirmation. The model list loaded again; OpenAI
remained active until Codex explicitly chose Luna and **Use ChatGPT**. A second
record-free answer completed with the title **HbA1c vs time in range**,
**General explanation · No personal records used** and a **Using ChatGPT plan**
footer. This verifies the returning-account path and a second real plan answer.
Live token-expiry renewal, quota and privacy-erase races were not deliberately
induced; automated checks cover those paths without making them separate live
release gates. Earlier private phone checks also completed the same record-free
question through the saved OpenAI **API key** with GPT-6.1 Sol and the usual Luna model. These do not
show that GPT-6.1 is available through this ChatGPT account. The private.5
source passed 5,405 TypeScript tests, 28 native tests, lint, typecheck and APK
verification. Exact public release and CI checks remain separate.

## Gemini comparison completed on 2 October 2026

The owner approved a comparison of `gemini-3.1-pro-preview` with the existing
`gemini-3.8-flash` and `gemini-3.7-flash` options. All three were available to the
configured API key. The production model selector and default were unchanged;
Pro was enabled only inside the private test harness.

Five record-free education questions were sent twice to each model: three
HbA1c/time-in-range questions and two questions distinguishing severe (level 3)
hypoglycaemia from glucose measurements. Each request used the same current app
instructions, JSON schema, LOW thinking, 4,096-token output ceiling and local
answer checks. Model order was reversed for the second repetition. There were
30 native requests, no retries of failed questions, and no personal records or
conversation history. Both repetitions shared one persistent $1/30-request
ledger. Three unattempted questions were resumed after correcting a harness
error classification; app instructions and checks remained unchanged throughout.

An independent review used anonymous model labels and question-specific criteria
based on the [ADA 2026 definitions](https://diabetesjournals.org/care/article/49/Supplement_1/S132/163927/6-Glycemic-Goals-Hypoglycemia-and-Hyperglycemic)
and [ADA time-in-range explanation](https://diabetes.org/about-diabetes/devices-technology/cgm-time-in-range).
The primary agent separately reviewed the answers and accepted the findings.
These are automated-agent reviews, not clinical validation. A clear answer count
means no substantive qualification was needed for that question; it is not a
general medical accuracy rate.

| Model | Clear answers in manual review | Accepted by app before fixes | Median response time | Estimated cost of 10 answers |
| --- | --- | --- | --- | --- |
| Gemini 3.8 Flash | 9/10 | 8/10 | 3.14 seconds | $0.02361 |
| Gemini 3.7 Flash | 10/10 | 9/10 | 7.83 seconds | $0.02484 |
| Gemini 3.1 Pro Preview | 9/10 | 10/10 | 8.29 seconds | $0.12386 |

All 30 responses returned HTTP 200 with native usage. Response time includes
body transfer/parsing and excludes the harness's deliberate request pacing.
Costs use reported input/output/thinking tokens and Google's
[Standard API prices](https://ai.google.dev/gemini-api/docs/pricing) verified on
2 October; they are usage estimates, not billing invoices. Total estimated cost
was $0.17230375. The ledger conservatively retained $0.23401825 including full
reservations for rejected answers.

The two qualified answers, one from 3.8 Flash and one from Pro, blurred the
distinction between aggregate time-below-range/variability statistics and
individual episode frequency or duration. Their second answers distinguished
these correctly. No answer incorrectly defined level 3 from a glucose threshold,
and none refused a valid general-education question. Pro was more concise;
3.7 was consistently precise but longer, and 3.8 was fastest. This small,
explicitly prompted sample does not establish a general model ranking or a
clear quality benefit from switching to Pro, which cost about five times as much.

The three app rejections were separate from those two answer-quality findings.
Two rejected a correct denial beginning "No, neither ... nor ..." because the
severity check missed the leading negation. One rejected "will not identify what
caused the change" because the causal check treated "caused the" as an assertion.
These are app-check false positives, not evidence that the models made those
clinical claims. Local replay also exposed a second check on one of those same
answers: a past-tense description of needing assistance was treated as a
treatment instruction.

The follow-up fixes recognise these specific denials and the descriptive
assistance clause in record-free education. They preserve the stricter
personal-evidence checks and continue rejecting affirmative severity claims,
mixed denial/affirmation sentences, and inserted or appended treatment commands.
Replaying all 30 saved raw responses through the real parser after the fixes
accepted 30/30, up from 27/30, without making new API calls. That is a parsing
result; the two precision qualifications above still apply. The relevant 360
education, guardrail, provider, request and evidence tests, TypeScript and focused
ESLint passed. Independent review found no remaining blocker in this narrow
change. No model, prompt, production default or release was changed by these fixes.

The reproducible case definitions and budget controls are in
`scripts/private-provider-comparison/`. Private raw responses, usage, anonymous
review inputs and the ledger remain outside the repository under the study ID
`gemini-20261002`. A rerun requires its own explicit live-dispatch configuration;
normal unit tests cannot send requests.

Google announced [Gemini 4 Argon on 30 September 2026](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/).
Access was limited to selected testers, with broader access forthcoming. On
2 October neither the public API catalogue nor the configured key's complete
model list exposed a Gemini 4 model, so it was not included in this comparison.

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

## 1.7.13 candidate correction

An exact local low-glucose question could show a valid no-data answer but fail
to save that answer in the conversation when the requested period had no
readings. The 1.7.13 candidate corrects conversation validation for that case.
Verify the saved no-data answer on the exact release artifact; this does not
make an AI provider request or change the Wear protocol.

## Final release verification

- Run the repository quality workflow on the intended PR head.
- Run the approved 30-question Tarv1s suite across the four connection choices,
  distinguishing local answers from actual AI calls. Check numeric and dated
  answers against the phone's stored records; restore the owner's OpenAI API
  selection after testing. Report any skipped question or unavailable model.
- Confirm the exact signed production build preserves the provider choices,
  secure keys, local counts and existing Wear companion protocol. The private
  phone build and passing older commits cannot stand in for release verification.
- The public privacy policy was updated on 5 October 2026 to disclose the
  optional ChatGPT plan route and its sign-in/model-list data flows. Resolve
  the dependency audit blockers in `RELEASE_STATUS.md` before publication.
  Review Google's account, billing, age and regional terms for the intended audience.
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
