# Hevy integration

T1 Arc's Hevy connection is an optional, read-only source for exact
strength-workout context. It is designed for users whose Hevy Pro account
exposes an API key in Hevy web settings.

## Contract

- Base URL: `https://api.hevyapp.com`
- Authentication: the `api-key` request header.
- Identity check: `GET /v1/user/info`.
- Initial import: paginated `GET /v1/workouts` requests with the documented
  maximum page size of 10.
- Later sync: paginated `GET /v1/workouts/events` requests using the last
  successful cursor with a one-minute overlap. Events are applied oldest first
  and updates/deletions are idempotent.
- Source: https://api.hevyapp.com/docs/

The client has a 20-second request timeout, fail-closed response validation,
and distinct user-facing errors for invalid credentials, rate limiting,
server failure, malformed responses and network failure. Existing workouts
are left unchanged when a request fails.

## Storage and privacy

- The API key and connected user identity use Expo SecureStore rather than the
  health database or portable backup. The connected name is shown in the Hevy
  card so the user can recognise the account; the key is not included in status
  messages or diagnostics.
- Workouts and exact exercise/set payloads use T1 Arc's encrypted database.
- Portable backup schema version 13 introduced the workout table, but never the
  API key.
- “Disconnect” deletes the secure credential and retains imported history.
- “Remove workouts” separately deletes Hevy detail and Hevy-only activity
  cards after confirmation. It does not delete a matching Health Connect
  record.

## Shared-timeline mapping

Each Hevy workout becomes a timed strength activity. Its title, start/end,
description, exercises, sets, repetitions, weights, distance, duration and RPE
are retained when the API supplied them. Intensity is derived only when at
least one set contains RPE; otherwise it is stored as `unspecified` and hidden
from user-facing summaries rather than guessed.

If a Health Connect activity begins within five minutes and ends within ten
minutes of the Hevy workout, T1 Arc links Hevy's detail to that existing event.
This prevents double-counting while preserving both provenances. The tolerance
is deliberately conservative and does not merge on title alone.

## User flow

Settings → Health and insulin → Hevy opens a focused source page. The user can:

1. Open the information disclosure for setup context.
2. Enter the key and choose **Test, connect and import**.
3. Review stored count, protected-key state and last successful sync.
4. Choose **Sync new and changed workouts** after another Hevy workout.
5. Disconnect or remove imported workouts as separate actions.

The first live account connection remains a real-credential acceptance test;
automated tests use contract fixtures and do not contact Hevy or expose a
private key.
