# Private Tarv1s response reports

This is the optional in-app feedback endpoint, not a health-data sync service
or an AI proxy. The app sends only text the user reviewed and consented to
share, a reason, version and random reference. It does not attach records or keys.

## Run and verify

Use Node 22.13 or later. From this directory:

```sh
npm ci
npm test
npm run types
npx wrangler deploy --dry-run
```

Generated types and local runtime state are ignored. Test fixtures contain no
personal data. Do not use real conversations for service smoke tests.

## Deploy

Authenticate with Cloudflare through Wrangler. Email Routing must be active for
t1arc.com and the destination t1arc.support@gmail.com must be verified. The
binding restricts delivery to that one inbox; user input cannot change sender,
recipient or headers. Verified-destination sending is available without a paid
Email Service plan. Do not enable paid resources without approval.

Set the intended account in Wrangler, attach reports.t1arc.com as a custom
domain, and deploy. Do not change root or www records. Before shipping the app,
test a synthetic report through public HTTPS and confirm arrival in the inbox.
`/health` does not verify delivery. HTTP 202 means the email service accepted
the report, not that a person has read it.

## Abuse and privacy boundaries

- JSON POST only; 52,000-byte streaming limit and 12,000-character text limit.
- Browser origins are rejected. This is not authentication: native clients
  and scripts can call the public endpoint. No reusable secret lives in the APK.
- Five attempts per minute per hourly hashed IP key and 30 per minute overall
  **per Cloudflare location**. These are best-effort local limits, not a global
  quota or a defence against a distributed attack. Shared IPs can be limited.
- No report database or automatic retry. After an uncertain result, repeated
  reports may share a reference; support should treat them as duplicates.
- User text is plain email body content, never instructions or HTML.
- No report body, IP, credential or raw exception is emitted by application logs.
  Cloudflare still processes network metadata. Review tracing configuration
  before enabling additional observability.
- Reports remain in the private inbox while investigated. The maintainer
  handles deletion requests by reference, including copies and trash. Do not
  forward sensitive reports to public GitHub issues.

If abuse affects the inbox, disable the endpoint or tighten limits. Do not
discard reports while claiming success. Monitor generic failures and verify
inbox delivery with synthetic content.

See [the technical privacy model](../../PRIVACY.md) and Cloudflare's
[send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/),
[pricing](https://developers.cloudflare.com/email-service/platform/pricing/) and
[rate-limit behaviour](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
