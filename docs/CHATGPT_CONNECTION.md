# Optional ChatGPT connection

Status: included in the corrected 1.7.15 candidate and verified for record-free
questions in an earlier private production-package phone build. Personal-data
questions and the corrected candidate still need device checks. The private
test is distinct from checks on
the exact public APK; publication status is shown by the
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

## Earlier private testing and resolved failures

The dated observations below explain how the private build reached the current
result. Their then-unverified states are superseded by the successful private.5
answer above; they do not describe the current release status.

Validation on 2 October 2026: the full TypeScript test suite passed (5,365 tests),
followed by five additional account-control and renewal-recovery tests. Nine Android protocol
tests and native release lint passed, and the Android debug APK built. Typecheck
and ESLint passed. The new module is included in pull-request native test/lint CI.
An independent review found no remaining code blocker after recovery and token
rotation fixes. Emulator checks confirmed settings navigation, all four provider
choices and the ChatGPT sign-in/cancel controls. Browser launch reached Chrome's
first-run screen, but the emulator process exited during Chrome startup on two
attempts, including a graphics fallback. A successful browser round-trip and
authenticated answer remain unverified. Automated tests used synthetic credentials
and records. The subsequent live Gemini comparison and narrow answer-check fixes
are documented in `AI_PROVIDER_TESTING.md`.

Follow-up on 2 October 2026: a combined debug APK containing the chart, ChatGPT and
Gemini changes was built for both ARM64 phones and x86_64 emulators. Its manifest,
signature and embedded JavaScript were verified. The separate development package
was installed on isolated Android 16 and Android 17 emulators. An existing desktop
ChatGPT session reached T1 Arc's account-selection and plan-access consent screens,
but this did not verify a completed connection in the Android app. One attempt
expired during test setup; another lost its callback when the Android 16 emulator
process crashed. Windows recorded a QEMU host access violation (`0xc0000005`), not
an Android application crash. A fresh Android 17 test reached Google's passkey
verification through the normal in-app sign-in flow. Physical-phone sign-in,
account-model listing and a completed plan-backed answer still remain unverified.

Physical-phone follow-up on 3 October 2026: the verified development APK was
installed alongside the existing app on a Pixel 10 Pro XL. The normal system
browser flow reached OpenAI consent. Although Edge still showed a loading consent
screen, returning to T1 Arc completed the connection: the app displayed the
validated account as connected and loaded five account-specific model choices.
This confirms a real callback, token exchange and model-catalog request. It does
not yet verify a completed plan-backed answer, token renewal, sign-out or plan
limits. The cause of Edge's lingering loading screen remains unconfirmed; the
tested APK's callback page provided manual return instructions only. The private
phone update adds a package-specific **Return to T1 Arc** button and a bounded
ten-minute browser authorization window. Native loopback tests and independent
review cover the new page and request handling; its Edge return action still
needs physical-phone verification.

Physical-phone follow-up on 4 October 2026: the everyday production-package
private update (`1.7.14-private.1`, phone code 58) retained the connected account.
A manual model refresh completed and showed five account-specific models; it
did not return GPT-6.1 Sol for this account. A new, record-free education question
failed with an unreadable-response error. Sign-in and model listing therefore
work on the everyday app, but a completed plan-backed answer is still unverified
and blocks release. Gemini was restored as the active provider after the test.
The next private candidate improves settings and separates request failures
without exposing provider error bodies or credentials.

The `1.7.14-private.2` candidate (phone code 60) was installed in place on the
same phone. Its settings and model pickers were checked on-device. GPT-6.1 Sol
completed the record-free education question through the saved OpenAI API key;
the usual OpenAI Luna model was restored after that test. The ChatGPT model
picker refreshed the account's five choices. Sending the same question through
ChatGPT reached the stream-handling stage but failed as an unexpected stream.
No completed ChatGPT answer has been verified. Release remains blocked on this
live flow; further diagnostics use fixed categories without provider content.

The next private phone candidate (`1.7.14-private.3`, code 62) isolated the
response failure: HTTP 200 without a Content-Type header. The bounded diagnostic
body was not ordinary JSON; this alone does not establish that it was a valid
stream. The next source revision accepts an absent header only through the
strict SSE parser. A fully terminated `response.completed` event containing a
completed response is still mandatory. Explicit non-SSE media types, unframed
JSON or HTML, empty bodies and partial answers remain failures. A successful
plan-backed answer on the phone is still required before release.

The private.4 phone candidate (code 64) then confirmed a completed SSE response
despite the missing header. Tarv1s's answer extractor still reported no answer
text, so a successful guarded answer remains unverified. The next revision
assembles completed assistant message events before passing the response to
the existing answer checks. It still requires successful terminal completion
and rejects refused or incomplete responses; live verification remains required.

The same private.3 phone update reported the existing Galaxy Watch companion as
ready and successfully queued the latest glucose for it. No watch update or
watch debugging was needed; the phone and watch continue to use the unchanged
version 1 capability and data protocol.

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
- Resolve the dependency audit blockers recorded in `RELEASE_STATUS.md`.
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
