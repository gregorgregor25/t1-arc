# Optional ChatGPT connection

Status: implemented in the current source, not released. Automated checks and
Android build verification do not replace a successful real-account sign-in and
plan-backed answer. Those live checks remain required before release.

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
returns. A saved model that disappears must be replaced explicitly. Separate
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

## Verification before release

- Test fresh sign-in, returning-account sign-in, browser cancellation and callback
  on a supported physical Android phone with an eligible account.
- Confirm account-specific model choices, a completed guarded answer, token
  refresh and sign-out. Verify plan limits show **Manage usage**, without API-key fallback.
- Check sign-out and privacy erase during pending authorization or inference,
  and switching between all four connection choices. Use synthetic health data.
- Retest Gemini's known severity wording with representative general-education
  questions. The new local wording guard is narrow and does not guarantee model accuracy.

Official protocol references: [open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
and [UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines).
