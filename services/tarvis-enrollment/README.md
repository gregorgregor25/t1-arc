# Archived Tarv1s enrolment experiment

This directory is retained as isolated research code. It is not built into the
T1 Arc APK, is not deployed for public users and is not required for Tarv1s.
The supported app uses the direct bring-your-own-key route documented in
[the Tarv1s guide](../../docs/TARV1S_BYOK.md).

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

Certificate issuance requires an explicitly configured, trusted attestation-root
allowlist. A root observed on an unverified device is not sufficient trust evidence.
No public enrolment service or physical-device acceptance is claimed here.
