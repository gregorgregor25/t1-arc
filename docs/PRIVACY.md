# T1 Arc privacy model

T1 Arc is designed around a simple rule: health records should stay on the phone unless the person using the app deliberately enables a feature that needs a network connection.

This document describes the current implementation. The project is under active development, so contributors should update it whenever storage, networking or connected services change.

## What stays on the phone

T1 Arc stores imported health records, calculated summaries, food logs, notes and saved observations in an encrypted SQLCipher database on the Android device.

Account credentials, session material and the optional OpenAI API key are held separately in Android secure storage. They are not placed in the health database, logs or encrypted backup archive.

Core calculations, including totals, time in range, coverage and deterministic comparisons, run locally.

## When the app connects to another service

Network access is used only for features the user chooses to configure. Depending on those choices, the app can connect directly to:

- LibreLinkUp;
- Nightscout;
- xDrip+;
- Glooko;
- Open Food Facts;
- the OpenAI API for eligible Tarv1s questions.

Android Health Connect is an on-device Android data exchange rather than a T1 Arc cloud service. The person using the app chooses which compatible record types and sources T1 Arc may read.

T1 Arc does not run a central account or health-data server.

## Tarv1s and bring your own key access

Tarv1s is an optional way to ask questions about Type 1 diabetes and the records available in T1 Arc.

The current implementation:

- stores the OpenAI API key in Android secure storage;
- waits for the user to tap Send before making a request;
- answers supported exact totals locally without calling a model;
- rejects unsupported, unsafe and credential-seeking questions locally;
- sends only a bounded evidence packet selected for the question;
- uses the OpenAI Responses API with response storage disabled;
- limits recent conversation context and response size;
- keeps evidence references attached to the answer;
- refuses insulin dose, treatment and prediction requests.

A general diabetes question does not need personal records. A question about the user's own pattern can include only the records needed for that comparison. The review screen explains what will be sent.

OpenAI is a separate service with its own terms, privacy policy and API billing. Anyone enabling Tarv1s should review those documents and use an API project they control.

## Backups

T1 Arc can create an encrypted local backup of supported health records and app settings. Credentials, session tokens, Glooko web cookies and the OpenAI API key are excluded.

Restoring adds missing records. It does not silently replace the current database or secure credentials.

## Logs and diagnostics

Application logs should not contain passwords, API keys or session tokens. Contributors and testers must still review logs and screenshots before sharing them because health values and device details may be visible in normal interface output.

## Data deletion

Removing a saved connection deletes its stored credentials and session. Existing imported history is retained separately so that disconnecting a source does not unexpectedly erase the user's record.

More granular deletion controls are still an area of active development. This limitation should be considered before treating the app as ready for broad distribution.

## Independence

T1 Arc is an independent project. LibreLinkUp, Nightscout, xDrip+, Glooko, Health Connect, Open Food Facts and OpenAI are named only to describe optional compatibility. Their trademarks and services belong to their respective owners.

## Reporting a privacy problem

Do not post sensitive details in a public issue. Follow [the security reporting process](../SECURITY.md) so the problem can be reviewed privately.
