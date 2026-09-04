# Tarv1s and your OpenAI API key

Tarv1s uses bring your own key. The maintainer and every other user follow the
same setup. There is no bundled maintainer key, hidden free allowance or relay
server in the normal app path.

## What works without OpenAI

Supported exact questions can be answered locally from records already on the
phone. Questions that need broader language reasoning show the OpenAI setup and
require the user to choose whether to send them.

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

When a broader question is sent, T1 Arc builds a bounded evidence packet from
the relevant dates and records. The request goes directly from the Android app
to the OpenAI Responses API. It is not sent through a T1 Arc server.

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
