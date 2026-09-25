# Tarv1s and your AI provider API key

Broader Tarv1s questions can use your own OpenAI, Google Gemini or Anthropic
Claude API key. Every user follows the same setup. There is no bundled
maintainer key, hidden free allowance or relay server in the normal app path.

## Choose a provider

In Tarv1s settings, select OpenAI, Google Gemini or Anthropic Claude. Read the
selected provider's data-use notice, enter its API key and choose **Save key on
this phone**. If a key is already saved, choose **Use selected provider**.
Saving checks the key's format and stores it locally; the first eligible AI
question checks actual API access. Saving does not send a test prompt.

Existing installations keep their OpenAI key and default provider. Each provider
has a separate secure key. Switching never substitutes another provider after an
error, and replacing or removing a key cancels outstanding model requests. Remove
saved key applies to the provider selected in settings; privacy erase removes all
three keys, the selected provider, safety identifier and usage counters.

The available models are GPT-5.6 Luna and Terra; Gemini 3.8 Flash and 3.7
Flash; and Claude Haiku 4.5, Sonnet 5 and Opus 5.5. The defaults are Luna,
Gemini 3.8 Flash and Claude Sonnet 5. There is no automatic model substitution
and no Recommended badge. Token usage is recorded for all providers. The
in-app cost estimate applies only to the default OpenAI Luna model; no Gemini
or Claude price is inferred from OpenAI rates. Check the selected provider's
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) or
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing),
also linked in settings. ChatGPT, Gemini and Claude chat subscriptions are
separate from API billing.

Requests go directly from the phone to the selected provider. The same bounded
evidence planner, local calculations, output validation and treatment boundaries
apply to every provider. General education sends no health records. Switching
providers can send recent previously shared conversation to the new provider on
the next question; start a new conversation to omit that history.

Use a billing-enabled Gemini API project for health information. Google's
[API terms](https://ai.google.dev/gemini-api/terms) prohibit sensitive or personal
information under unpaid-service terms and impose paid-service requirements for
apps in the UK, EEA and Switzerland. The terms require API users to be at least
18 and prohibit API clients directed towards or likely to be accessed by
under-18s. They prohibit using the service in clinical practice or to provide
medical advice. Review the regional and other use restrictions for your
account. Claude's
[API data policies](https://privacy.claude.com/en/articles/7996868-how-long-do-you-store-my-data)
apply to Claude; OpenAI's storage controls below do not describe other providers.

On authentication failures, use **API settings** in the error message. Rate-limit
errors keep the question and impose a cooldown (at least 30 seconds, respecting
Retry-After up to 24 hours). Requests are never retried automatically. Network
failures, timeouts, safety blocks and incomplete responses do not add blank
assistant messages. A verified local fallback may still be displayed alongside
the provider error; the draft remains available for retry.

Implementation references: [Gemini generateContent](https://ai.google.dev/api/generate-content),
[Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
and [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
Native provider requests and failures have automated coverage. The
[dated provider test record](AI_PROVIDER_TESTING.md) describes live-key and
phone validation and its limits.

## What works without an AI provider

Some exact questions can be answered locally from records already on the
phone. Questions that need broader language reasoning show the provider setup and
require the user to choose whether to send them.

Opening Tarv1s, seeing starter questions, saving an answer in your notebook or
preparing appointment notes does not make a provider request. Exact local
calculations do not become paid AI requests just because a key is saved.

## What you can ask

Ask in your own words. There is no fixed list of questions. Tarv1s can explain
Type 1 diabetes, health, nutrition, exercise, sleep and wellbeing, or help you
explore the records available in T1 Arc.

- "What does HbA1c mean?" is a general question. It does not need your records.
- "Compare my lows over the last seven days with the previous seven days" needs
  the requested dates and glucose data.
- "What patterns do my meals, activity and sleep suggest?" asks for a review of
  the available evidence. Missing records and uncertainty should be stated, not
  filled in with guesses.

General AI explanations are not source-reviewed clinical guidance. Where T1 Arc
has a reviewed guidance item, it shows that item and its source separately. It
does not invent a guideline when the requested source is unavailable. Here,
"reviewed" identifies curated source-linked content with a recorded review date.
It does not establish independent clinical certification of T1 Arc or its answers.

Tarv1s must not diagnose, recommend treatment, provide doses or suggest medication
or pump-setting changes. A pattern in the records does not prove what caused it.

## Start from the records you are viewing

**Ask Tarv1s about this** opens a draft for a selected period or event where that
control is shown. The selected dates appear above the message. Review the draft
and tap Send when ready. If you rewrite the question, the selected-context chip
clears and the message follows the normal free-form question path.

Starter questions use the data available in T1 Arc rather than assuming that you
have logged a workout, a meal or a recent low. They are suggestions, not a list
of the only questions you can ask.

Simple results lead with the answer. **View calculation and records** opens the
supporting details. Missing data and other limitations that affect an answer
remain visible; a shorter presentation does not mean the app filled gaps or
became more certain.

## Save an answer or prepare appointment notes

Use **Save to notebook** beneath an answer, then **Saved · Open notebook** to
add a personal note or question. Saving keeps the answer, its supporting record
summary and limitations on the phone. A glucose chart is captured only when the
original supporting readings are available within the chart limit. Saved items
do not refresh themselves into new AI analyses.

The notebook separates the current connection from **Other saved records**, such
as items associated with a previous connection or a restored backup. Other saved
records cannot be edited, but you can remove an archived item. They are not
automatically included in a summary. Check that they belong to you before
choosing to include them.

Choose **Prepare appointment notes**, select up to five items, then preview.
**Share this text** opens Android sharing. **Save printable HTML** lets you choose
a file destination; open the file in a browser to read or print it. Both contain
readable health information and are **not encrypted**. No AI provider request
is used to assemble them, and T1 Arc does not send them automatically.

Deleting a notebook item does not delete the original conversation or health
history. Portable encrypted backups include supported notebook records but never
include any provider API key.

## OpenAI Luna cost example

**T1 Arc is free. Local factual answers are free.** Optional AI requests are
billed by the selected provider using your own API key; there is no T1 Arc
subscription or markup. A chat subscription does not include API usage. The
example below applies only when you select OpenAI Luna.

The default OpenAI model is **GPT-5.6 Luna**. As checked on 17 September 2026,
standard text pricing is **US$0.20 per million input tokens** and **US$1.20 per
million output tokens**. Tokens are small pieces of text; the input includes
instructions and selected evidence as well as your question.

For illustration, a request using **10,000 input tokens and 2,000 billed output
tokens costs US$0.0044**—less than half a US cent. One hundred requests of that
same size would cost US$0.44. This is a worked example, not a measured average
or a promise about your bill. Longer context, billable reasoning, repeated
requests and longer answers change the cost. Currency conversion and tax may
also apply; check any minimum credit purchase in the billing screen.

Check [current model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
and [your usage](https://platform.openai.com/usage). Set suitable spend controls
before use; the setup below explains them.

## Set up a dedicated OpenAI key

1. Sign in to the [OpenAI API platform](https://platform.openai.com/).
2. Create a separate project for T1 Arc.
3. Set spend alerts and, if you want requests to stop at a budget, enable an
   enforced hard spend limit. Alerts alone do not stop requests, and hard-limit
   enforcement can lag slightly. See [OpenAI spend controls](https://developers.openai.com/api/docs/guides/spend-limits).
4. Create a standard project API key. Do not use an organization admin key.
5. In T1 Arc, open **Tarv1s**, then **Tarv1s settings**. Select OpenAI, choose
   your model, paste the key and select **Save key on this phone**. The same
   settings screen provides key-creation, privacy and pricing links for Gemini
   and Claude when you select either of those providers.

Saving stores the key locally. It does not verify billing or model access with
OpenAI. The first broader question checks those when it is sent. No health
records are sent by the save button.

OpenAI API usage and a ChatGPT subscription are separate. Billing, model access
and service limits belong to the API project that issued the key and can change
over time. Check them in the OpenAI platform rather than relying on values copied
into this guide.

Useful official pages:

- [API quickstart and key creation](https://platform.openai.com/docs/quickstart)
- [API authentication](https://developers.openai.com/api/reference/overview#authentication)
- [API usage](https://platform.openai.com/usage)
- [API billing settings](https://platform.openai.com/settings/organization/billing/overview)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

## What leaves the phone

For a personal-data question, T1 Arc builds a bounded evidence packet from the
relevant dates and records. General explanations receive the question without a
personal evidence packet. A dependent follow-up can include recent shared
conversation so Tarv1s understands what you mean. Start a new conversation to
omit that history before switching providers.

The request goes directly from the Android app to the selected provider's API:
OpenAI Responses, Gemini generateContent or Claude Messages. It is not sent
through a T1 Arc server. An error does not silently reroute it to another AI
provider.

OpenAI requests also include a random, locally stored safety identifier. It is
not derived from your name, email or health readings, but it can associate
requests from that stored identifier. The selected provider receives normal
connection metadata, such as the phone's public IP address. This is not an
anonymous or zero-data connection.

OpenAI requests set `store: false`. According to the official OpenAI
documentation, this disables optional Responses API application-state storage.
It does not mean that no operational data can ever be retained. OpenAI
documents separate abuse monitoring logs and account-specific data controls.
Read the current [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
before sending health information. This OpenAI setting does not describe
Gemini or Claude retention; review the provider privacy links above.

Nothing is sent merely because the key has been saved. A request is made when
the user submits an eligible question.

## Where the key is kept

T1 Arc stores each provider's key separately using Android secure storage and
excludes all keys from portable backups. Removing local app data removes the
app's stored copies. Revoking a key with its provider prevents future use even
if an old device still has a copy.

There is an important security tradeoff. OpenAI's official authentication
guidance says API keys should not be exposed in client-side apps and recommends
loading them from a server-side environment or key-management service. Direct
BYOK keeps T1 Arc from operating a health-data relay, but each saved key still
exists on the user's Android device. A determined attacker with control of the
device or a modified build may be able to extract or misuse it.

Reduce that risk:

- use a dedicated project or key, not one shared with other work;
- set spend controls with the selected provider;
- never paste the key into an issue, screenshot, backup or chat;
- install only builds you trust;
- revoke and replace the key if the phone, build or key may be compromised.

## What Tarv1s must not do

Tarv1s is not an insulin-dose calculator, medical device or emergency service.
Answers should retain supporting dates and records, distinguish observation from
causation, and say when the available data is insufficient.

Do not use it as the sole basis for a treatment decision. Use the official CGM
or pump display and contact an appropriate clinician or emergency service when
needed.

## Troubleshooting

### Report a response privately

Choose **Report response** below an answer to tell T1 Arc support about unsafe,
incorrect, offensive or privacy-related content. Write a message and optionally
include the response, then review and edit what will be sent. Nothing from your
conversation is attached automatically. You must agree before sending.

Reports go through Cloudflare to the private support inbox. Keep the reference
if you want to follow up or request deletion at support@t1arc.com. This is not
an emergency or medical support service. See [report data handling](../PRIVACY.md#voluntary-support-and-tarv1s-response-reports).

### Connection problems

- **The key is rejected:** confirm it belongs to the selected provider and its
  project permits the selected model. Key format validation alone does not
  verify account access.
- **A request is rate-limited:** wait for the project limit to reset or review
  its limits in the selected provider's console. The app keeps the question.
- **Billing is unavailable:** check the selected provider's API project and
  organization. Chat subscriptions do not automatically provide API credit.
- **You changed phones or builds:** enter the key again. Portable T1 Arc backups
  deliberately exclude it.
- **You suspect exposure:** revoke the key first, then create a replacement.

This guide summarizes the app's design. Each provider remains the authority for
its service behaviour, eligibility, pricing, data handling, limits and terms.
