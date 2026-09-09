# Tarv1s and your OpenAI API key

Tarv1s uses bring your own key. The maintainer and every other user follow the
same setup. There is no bundled maintainer key, hidden free allowance or relay
server in the normal app path.

## What works without OpenAI

Some exact questions can be answered locally from records already on the
phone. Questions that need broader language reasoning show the OpenAI setup and
require the user to choose whether to send them.

Opening Tarv1s, seeing starter questions, saving an answer in your notebook or
preparing appointment notes does not make an OpenAI request. Exact local
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
readable health information and are **not encrypted**. No OpenAI request is used
to assemble them, and T1 Arc does not send them automatically.

Deleting a notebook item does not delete the original conversation or health
history. Portable encrypted backups include supported notebook records but never
include your OpenAI key.

## Set up a dedicated key

1. Sign in to the [OpenAI API platform](https://platform.openai.com/).
2. Create a separate project for T1 Arc.
3. Set spend alerts and, if you want requests to stop at a budget, enable an
   enforced hard spend limit. Alerts alone do not stop requests, and hard-limit
   enforcement can lag slightly. See [OpenAI spend controls](https://developers.openai.com/api/docs/guides/spend-limits).
4. Create a standard project API key. Do not use an organization admin key.
5. In T1 Arc, open **Tarv1s**, open conversation history at the top left, then
   choose **Tarv1s settings**. Paste the key and select **Save key on this phone**.

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
personal evidence packet. A dependent follow-up can include the immediately
preceding exchange so Tarv1s understands what you mean.

The request goes directly from the Android app to the OpenAI Responses API. It
is not sent through a T1 Arc server.

Requests also include a random, locally stored safety identifier. It is not
derived from your name, email or health readings, but it can associate requests
from that stored identifier. OpenAI also receives normal connection metadata,
such as the phone's public IP address. This is not an anonymous or zero-data
connection.

The request sets `store: false`. According to the official OpenAI documentation,
this disables optional Responses API application-state storage. It does not mean
that no operational data can ever be retained. OpenAI documents separate abuse
monitoring logs and account-specific data controls. Read the current
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
before sending health information.

Nothing is sent merely because the key has been saved. A request is made when
the user submits an eligible question.

## Where the key is kept

T1 Arc stores the key using Android secure storage and excludes it from portable
backups. Removing local app data removes the app's stored copy. Revoking the key
in the OpenAI platform prevents future use even if an old device still has a
copy.

There is an important security tradeoff. OpenAI's official authentication
guidance says API keys should not be exposed in client-side apps and recommends
loading them from a server-side environment or key-management service. Direct
BYOK deliberately keeps T1 Arc from operating a health-data relay, but the key
still exists on the user's Android device. A determined attacker with control of
the device or a modified build may be able to extract or misuse it.

Reduce that risk:

- use a dedicated T1 Arc project, not a key shared with other work;
- set spend alerts and an enforced hard limit if you need a spending cap;
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

- **The key is rejected:** confirm it is a current standard project API key and
  that the project permits Responses API calls.
- **A request is rate-limited:** wait for the project limit to reset or review
  its limits in the OpenAI platform.
- **Billing is unavailable:** check the API platform project and organization.
  A ChatGPT plan does not automatically provide API credit.
- **You changed phones or builds:** enter the key again. Portable T1 Arc backups
  deliberately exclude it.
- **You suspect exposure:** revoke the key first, then create a replacement.

This guide summarizes the app's design and links to the OpenAI Docs used for the
current security and data-control statements. OpenAI remains the authority for
its service behaviour, eligibility, limits and terms.
