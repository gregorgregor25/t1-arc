# Archived Tarv1s lab backend

This experiment is not shipped in the APK, deployed for app users or required
for Tarv1s. The supported app path is [direct BYOK](../../docs/TARV1S_BYOK.md).
The trial descriptions and model defaults below document this isolated code,
not a current public service or guaranteed model entitlement. Use synthetic
snapshots when reproducing it; private trial data is not distributed.

This is an isolated, developer-only experiment for testing whether an AI-led TARV1S can answer natural-language questions across T1 Arc's real stored data shape. It does not replace the current in-app TARV1S path and is not a production health-data service.

For the private browser trial, the service opens one backup-derived SQLite snapshot read-only. Its included health rows retain the original table names, column names and scalar values - there is no answer-oriented normalization or pre-calculation. A model can inspect the catalogue and issue bounded read-only SQL queries. The service executes the SQL and gives only the query results back to the model so it can compose a human answer with explicit evidence IDs.

The older normalized upload/session API remains available for controlled comparisons, but the browser interface does not use it.

## Privacy and safety properties

- The browser snapshot is mounted read-only from a RAM-backed host path such as `/dev/shm`, so a reboot removes it; the service never writes to it.
- Uploaded normalized API sessions, if used, exist only in process memory and expire after 30 idle minutes by default.
- Completed and failed test runs are saved in a private RAM-backed JSONL journal so their question,
  answer, SQL evidence and timings can be compared after the trial. Credentials are never included.
- SQLite is switched to `query_only`, extension loading is disabled, SQL is restricted to one non-recursive `SELECT`, and every tool result is capped.
- The browser raw snapshot must match the exact allowlisted backup-v16 table and column shape. Credential state, notification payloads, saved insights/old TARV1S answers, source archives and app state are excluded before deployment.
- OpenAI receives the question, conversation history, dataset catalogue and the bounded results of SQL selected by the model. It does not receive the whole snapshot as a prompt.
- Stored titles, notes and labels are treated as untrusted data, never model instructions.
- `store: false` is set on every Responses API call.
- The container is read-only, drops all Linux capabilities, disables swap and core dumps, uses a small temporary filesystem and binds to host loopback in the supplied Compose file.

Ephemeral storage is not the same as “no data processing”. The question and selected evidence still leave the private lab host for the configured model provider. Do not expose this experiment to other users or the public internet. A real service still needs an authenticated TLS edge, access controls, audit design, deletion/retention policy, privacy documentation and a reviewed data-processing basis.

## Requirements

- Node.js 24, matching the container and archived-service CI job.
- An OpenAI API key supplied by one of:
  - `OPENAI_API_KEY`
  - `OPENAI_API_KEY_FILE`
  - the private remembered-key file configured with `REMEMBERED_OPENAI_API_KEY_FILE`
  - `X-OpenAI-API-Key` per question only when `ALLOW_CLIENT_OPENAI_KEY=1`

The key is never written into a session. The optional client-key header is for the private developer trial only.

## Run without Docker

Run from `services/tarvis-lab`. Create a local `.env` from the example and edit
it privately. Use a key-file path rather than putting a key in shell history.
The ordinary `npm start` command reads the process environment; it does not
load `.env` automatically. To load that file explicitly:

```powershell
Copy-Item .env.example .env
# Edit .env privately before starting. Do not commit it.
node --env-file=.env --disable-warning=ExperimentalWarning src/index.js
```

The default address is `http://127.0.0.1:7313`. Set `HOST` and `PORT` to override it. The health endpoint is:

```text
GET /dev/v1/health
```

## Private browser lab

Open `http://127.0.0.1:7313/` for the self-contained dark browser interface. It
uses the single dataset loaded by the server; there is no snapshot picker or
health-data upload in the page. After a successful Connect, the service token is
remembered for 30 days in a path-scoped HttpOnly, SameSite browser cookie containing
an opaque derived access token (not the service bearer token), and the OpenAI key
is stored outside the project in the private file configured by
`REMEMBERED_OPENAI_API_KEY_FILE` (mode `0600`). Neither credential is placed in
browser storage or the result journal. Because this temporary LAN site uses HTTP,
its cookie cannot use the `Secure` attribute; use it only on the trusted home LAN.
Clearing the chat removes the visible conversation without deleting or replacing
the server dataset.

Set `RAW_SQLITE_HOST_PATH` to the verified raw SQLite file on the host. Compose
mounts it read-only at `/run/tarvis-data/raw.sqlite`, and the service refuses to
open it if its table/column allowlist, exclusion manifest or SQLite integrity
check fails.

The selector defaults to Luna and exposes only the models in
`OPENAI_ALLOWED_MODELS`. Luna and Terra are enabled by default. To test Sol,
append `gpt-5.6-sol` to that comma-separated allowlist. `OPENAI_MODEL` controls
the initially selected model and must also appear in the allowlist.

For the phone-local LFM experiment, append
`lfm2.5-1.2b-thinking-phone` to the allowlist and configure
`LFM_PHONE_CHAT_COMPLETIONS_URL` with the phone's authenticated llama.cpp
`/v1/chat/completions` endpoint. Put the matching key in the server-only file
named by `LFM_PHONE_API_KEY_FILE`. The browser receives neither the endpoint nor
the key. Model inference happens on the phone while this temporary lab continues
to execute its existing read-only snapshot queries on the private lab host and journal the same
answer, evidence and timing structure used for Luna comparisons.

Browser snapshot status and question routes use the same optional
`TARVIS_LAB_BEARER_TOKEN` protection as the existing API. The static shell has
no external assets and every static or API response is sent with
`Cache-Control: no-store`.

Set `TARVIS_SECRET_HOST_DIR` to a persistent private host directory owned by the
container's service user. Compose mounts only that directory read-write at
`/run/tarvis-secrets`; the rest of the container remains read-only. Delete its
`openai-api-key` file and rotate `TARVIS_LAB_BEARER_TOKEN` to revoke remembered
access after the experiment.

## Run on a private host with Docker Compose

Create a private `.env` beside `compose.yaml`, then:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:7313/dev/v1/health
```

Compose uses Docker's existing default bridge. It publishes on
`TARVIS_LAB_BIND_IP`, which defaults to host loopback. For an isolated private
network test it may be set to that host's private address, protected with
`TARVIS_LAB_BEARER_TOKEN`; do not publish it on `0.0.0.0` or expose it to the
internet.

For a file-mounted OpenAI key, create a root-readable file outside this directory and add a local Compose override that mounts it read-only at `/run/secrets/openai_api_key`; set `OPENAI_API_KEY_FILE=/run/secrets/openai_api_key` and leave `OPENAI_API_KEY` blank.

## API

All responses use `Cache-Control: no-store`. If `TARVIS_LAB_BEARER_TOKEN` is configured, send `Authorization: Bearer <token>` on every endpoint except health.

### Create an ephemeral session

```text
POST /dev/v1/sessions
Content-Type: application/json
```

The request shape is:

```json
{
  "schemaVersion": 1,
  "timezone": "Europe/London",
  "generatedAtMs": 1787677200000,
  "range": { "startMs": 1785085200000, "endMs": 1787677200000 },
  "tables": {
    "glucose_readings": [],
    "glucose_observation_intervals": [],
    "basal_deliveries": [],
    "basal_daily_segments": [],
    "bolus_deliveries": [],
    "insulin_daily_totals": [],
    "pump_states": [],
    "context_events": [],
    "meal_items": [],
    "strength_workouts": [],
    "strength_exercises": [],
    "strength_sets": [],
    "health_metrics": [],
    "daily_health_metrics": [],
    "source_statuses": []
  }
}
```

Every row must contain every listed column for its table, including explicit `null` for unavailable optional values. The authoritative matching archived client contract is `services/tarvis-lab/client/experimentalDataset.ts`.

### Ask a question

```text
POST /dev/v1/sessions/{sessionId}/questions
Content-Type: application/json

{"question":"How many carbs did I log yesterday, and how much bolus insulin did I take?","asOfMs":1787677200000}
```

`asOfMs` gives TARV1S a trusted clock for words such as “today” and “yesterday”. Optional `history` can contain up to 12 `{ "role": "user|assistant", "content": "..." }` messages. A developer client may also supply an opaque `turnId` of at most 200 characters. A successful response has this stable shape:

```json
{
  "answer": {
    "headline": "Direct answer",
    "answer": "Friendly evidence-grounded explanation.",
    "confidence": "high",
    "evidenceIds": ["q1"],
    "limitations": []
  },
  "evidence": [
    {
      "id": "q1",
      "purpose": "What the query established",
      "sql": "SELECT ...",
      "columns": ["..."],
      "rowCount": 1,
      "preview": [{ "...": "..." }],
      "truncated": false
    }
  ],
  "metrics": {
    "model": "gpt-5.6-luna",
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "modelRounds": 2,
    "sqlCalls": 1,
    "sqlMs": 1,
    "modelMs": 1000,
    "totalMs": 1001
  }
}
```

### Destroy a session immediately

```text
DELETE /dev/v1/sessions/{sessionId}
```

This returns `204 No Content`. Expired or unknown sessions return `404`.

## Limits

- Snapshot request body: 32 MiB by default, 128 MiB hard configuration ceiling.
- Total validated rows: 1,000,000, with stricter per-table limits.
- Question: 2,000 characters; optional history: 12 messages.
- SQL: one 12,000-character `SELECT`; 200 result rows and about 60,000 JSON characters per call.
- OpenAI model loop: six tool rounds by default, configurable up to 12, with
  at most 18 total tool calls.
- OpenAI model-analysis deadline: 60 seconds by default, configurable up to
  180 seconds and shared across model rounds. The separate phone-local LFM
  experiment has its own timeout setting; these are not app response-time promises.

## Tests

```bash
npm test
```

The tests cover schema rejection, SQLite read-only enforcement, query limits, TTL expiry, HTTP lifecycle/authentication and a mocked Responses API tool loop. They do not send personal data or call OpenAI.
