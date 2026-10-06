# Optional ChatGPT connection

Status: included in the corrected 1.7.17 candidate and verified for record-free
questions in an earlier private production-package phone build. Personal-data
questions and the corrected 1.7.17 candidate still need device checks. The
signed 1.7.15 draft passed its build, but was held after a current-period
personal-answer presentation regression appeared during device testing; that
observation is not acceptance of a hosted personal answer. The signed 1.7.16
draft also remains unpublished because phone backup comparisons exposed a
pre-existing Health Connect sync boundary issue. Publication status
is shown by the
[GitHub releases](https://github.com/gregorgregor25/t1-arc/releases).

On 4 October 2026, `1.7.14-private.5` (phone code 66) was installed in place
with the production package and signer, retaining the owner's app data. The
installed source revision was `8177e59`. A real ChatGPT plan request using an
account-offered Luna model completed on the phone: Tarv1s displayed a record-free
HbA1c/time-in-range explanation marked **General explanation · No personal
records used**. It did not retry through an API key. The response fix assembles
completed assistant message events within the strict SSE stream and still
requires a successful terminal `response.completed` event. During Codex-led QA,
sign-out reported successful remote revocation and the explicit browser sign-in
cancel control worked. A normal returning-account reconnect then succeeded
through Edge using the saved, authorized account. The **Return to T1 Arc** link
opened Android's usual Edge confirmation and returned to the app. The account
catalogue loaded again; Codex explicitly selected Luna, then deliberately
switched from the still-active OpenAI API-key connection to ChatGPT. A second
record-free answer completed with the title **HbA1c vs time in range**, the
**General explanation · No personal records used** label and a **Using ChatGPT
plan** footer. The account's five-model catalogue did not offer GPT-6.1, so no
ChatGPT plan model outside that live list is promised. The owner's usual API-key choice is OpenAI
Luna; Gemini was only a temporary QA selection.

The private build passed 5,405 TypeScript tests, 28 native tests, lint,
typecheck and APK verification. OpenAI API-key Luna and GPT-6.1 Sol each
completed the record-free question in earlier physical-phone checks. The
existing Galaxy Watch 8 companion remained ready and accepted a queued glucose
snapshot on private.5 (code 66); no companion reinstall, protocol change or
watch debugging was needed. The exact public build and CI have separate checks.

## Earlier private testing

Earlier private builds exposed browser-return and response-stream errors. They
were corrected before the successful private.5 checks described above. The
response reader requires a completed SSE response and rejects refusals, partial
answers and unframed content. These earlier checks do not establish that the
corrected 1.7.17 APK answers personal questions correctly; that remains an
explicit device release check.

Tarv1s still answers supported local questions without an account. For broader
AI questions, choose either **ChatGPT** or an API key for **OpenAI**, **Google
Gemini** or **Anthropic Claude**. No account is required to use the rest of T1 Arc.

## Connect

1. Open Tarv1s settings and choose **ChatGPT**.
2. Choose **Continue with ChatGPT**. Sign in and grant access in the system browser.
3. Return to T1 Arc, choose an available model and choose **Use ChatGPT for AI answers**.

The documented preview supports eligible Plus and Pro accounts. Access and
allowances are controlled by OpenAI; T1 Arc does not promise unlimited usage or
access for every account. Manage usage at [ChatGPT settings](https://chatgpt.com/settings/usage).
ChatGPT plan usage is separate from API billing. T1 Arc never switches to a saved
API key or another provider after an error.

Models are loaded from the active account and displayed in the order OpenAI
returns. Opening the model picker refreshes a catalogue older than five minutes;
**Refresh models** always requests a fresh list. Availability depends on the
account, so an API model is not added to this list by assumption. A saved model
that disappears must be replaced explicitly. Separate
ChatGPT registrations stay separate even when they have the same email address.

## What is shared and stored

The existing Tarv1s evidence selection and answer checks apply. An AI question
shares only its disclosed context and recent shared conversation when you tap
Send. Switching accounts or providers can send that conversation to the newly
selected connection on your next question; start a new conversation to omit it.
T1 Arc cannot read your existing ChatGPT conversations through this connection.

The app has no T1 Arc relay or shared service key. OAuth credentials stay in
epoch-bound Android secure storage, outside portable backups. The browser uses
OpenAI's authorization page; T1 Arc never handles a ChatGPT password. The native
callback listens only on `127.0.0.1` with a temporary port. Fresh PKCE, state and
nonce values and signed identity-token validation bind each authorization.
Sign-in, token renewal and model-list refresh contact OpenAI but do not send
health records or Tarv1s questions. The random safety identifier used by the
OpenAI **API-key** route is not added to ChatGPT plan requests.

Responses use the public OpenAI Responses endpoint with `store: false` and
`stream: true`. OpenAI's applicable privacy and retention terms still apply;
requesting no response storage is not a promise of zero retention. Only a
completed response is processed as an answer. Interrupted streams and plan
limits keep the question available without retrying automatically.

Sign-out cancels outstanding requests, attempts remote token revocation and
removes the active connection's credentials locally. If remote revocation cannot
be confirmed, the app asks you to review connected apps in ChatGPT settings.
Registration mappings remain for reconnecting. Full local privacy erase removes
those mappings and credentials too; remote permissions can also be removed from
ChatGPT settings.

Before downgrading to a version that predates this feature, select one of the
API-key connection options in the newer build. Older builds cannot read a saved
ChatGPT provider selection and will show a Tarv1s settings error; they do not
silently charge a saved API key. If already downgraded, reinstall the newer build
to change the selection, preserving app data. The development test APK uses a
separate app package and does not change the installed release's settings.

## Remaining release checks

- The public privacy policy was updated on 5 October 2026 with the optional
  ChatGPT route, sign-in and model-list traffic, local tokens, Send-only health
  context and the provider's terms.
- Complete the guarded 1.7.17 dependency review, audit and build checks
  recorded in `RELEASE_STATUS.md`.
- Verify the exact intended public source, signed artifact and CI checks. The
  private phone tests do not stand in for that release verification.
- Ask ChatGPT about the owner's glucose, sleep and basal records on the corrected
  phone build. Compare supported totals and dates with the local records, and
  confirm it explains missing basal timing without inventing hourly delivery.

Token-expiry renewal, a live plan-limit response and privacy erase during a
pending request were not deliberately induced on the owner's phone. Their
automated checks remain part of release CI; these unforced live scenarios are
not separate publication gates. Model answers still need user review, including
the known Gemini wording limitation described in `AI_PROVIDER_TESTING.md`.

Official protocol references: [open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
and [UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines).
