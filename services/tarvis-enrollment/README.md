# Archived Tarv1s enrolment experiment

This directory is retained as isolated research code. It is not built into the
T1 Arc APK, is not deployed for public users and is not required for Tarv1s.
The supported app uses the direct bring-your-own-key route documented in
`docs/TARV1S_BYOK.md`.

This isolated service issues a short-lived client certificate for an attested
Android Keystore public key. It is a development proof only. It never accepts
questions, health records, tool results, or model answers and it never proxies
OpenAI traffic.

The service starts only when an explicit bearer token and CA paths are
configured. Its development CA must never be reused for production.

Before issuing a certificate, the service verifies the one-time challenge,
hardware-backed Android key attestation, locked/verified boot state, allowed
application package, allowed app-signing certificate and trusted attestation
root. Its HTTP schema is closed and size-capped. The example host is
`https://enrolment.example.invalid`; only `/poc/v1/health` is unauthenticated.

The first physical-phone enrolment is expected to identify the phone's Google
attestation root so it can be placed on the explicit root allowlist. Until then,
certificate issuance is intentionally fail-closed.
