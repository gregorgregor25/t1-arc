# LibreLinkUp regional redirect recovery

## Problem

A data request can receive a successful JSON response containing
`data.redirect: true` and a `data.region` string instead of glucose data.
This was reproduced on a Pixel with a US VPN enabled while the official
LibreLinkUp app remained able to display readings. Disabling the VPN restored
successful checks; enabling it again reproduced the response shape.

T1 Arc previously handled regional redirects only during login. A redirect from
`/llu/connections` therefore failed validation as a missing patient list and
subsequent checks repeated the failure using the same route.

## Change

The client follows regional instructions during connections and graph requests,
persists the validated region, and retries the same endpoint with its existing
account session. This does not choose a different patient or sign in again
unless the existing token is independently rejected.

- Region strings use the existing validation and only construct HTTPS hosts
  within the configured LibreView domain; arbitrary redirect URLs are rejected.
- At most two regional redirects per data request are allowed; a redirect back
  to the current region fails immediately with a network/VPN troubleshooting
  message.
- Rate limits, account actions and HTTP failures are handled before routing.
- Authentication and client-version retries retain the regional redirect count.
- Unexpected responses remain failures; no readings are invented or relabelled
  as current.

Temporary response-shape diagnostics were removed from the delivered code.

## Verification

The regression suite covers redirects during connections and graph requests,
route persistence, unchanged credentials, invalid regions, loops, error
precedence and token renewal. A physical-device check confirmed automatic
recovery under the reproduced VPN routing condition without a manual sign-in.
Private device evidence is not a public test fixture.

This fixes the reproduced regional-routing failure. It does not establish the
cause of separate incidents where both T1 Arc and official LibreLinkUp returned
old readings.
