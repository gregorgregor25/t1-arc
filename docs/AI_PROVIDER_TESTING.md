# AI provider choice: pre-release validation

Draft implementation for issue #12. The Android Auto guide is reviewed separately
on an owner-only Site; it has not been added to the public website.

## Ready for device testing

1. Open Tarv1s settings. An existing installation should retain its OpenAI key.
2. Select Gemini or Claude, read the data-use notice and enter a dedicated API key
   on the phone. Do not put keys into chat, issues or screenshots. Gemini testing
   with health records requires a billing-enabled project and applicable terms.
3. Save the key. Saving is local and does not claim authentication succeeded.
4. Ask “What does HbA1c mean?” first: this uses no health records. Check the model
   returned a readable explanation without blank messages or truncated JSON.
5. With consent to share the selected records, ask one retrospective question
   and one evidence comparison. Verify the facts against local records and
   inspect the evidence list. Check missing data is still clearly reported.
6. Switch to each provider and back. Keys should remain separate. Start a new
   conversation if previous shared context should not go to the new provider.
7. Enter a wrong-format key (local rejection), then a revoked test key (provider
   rejection). Check the API settings shortcut and that the question remains.
8. Test airplane mode and reconnection. Check a failed draft can be retried. Do
   not deliberately generate charges to trigger a quota error; that path has
   mocked coverage. Confirm billing in the provider console.
9. Remove each provider key. Confirm local calculations still work. Use a
   disposable installation to verify privacy erase clears every saved key.

## Before a release

- Run the repository quality workflow on the intended PR head.
- Complete real-key testing for both providers and visual phone QA of settings,
  switching, failure recovery and persistence across app restarts.
- Confirm model access for the account; defaults were checked against official
  model documentation, but no Gemini or Claude live request has been made yet.
- Update the public privacy policy and setup documentation to list Google and
  Anthropic before enabling this in a published app. Review Google's account,
  billing, age and regional terms for the intended audience.
- Keep this as a phone-only change. There are no Wear OS code, version or protocol
  changes, and no reason to reinstall a working companion or enable watch debugging.

API contracts: [Gemini](https://ai.google.dev/api/generate-content),
[Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[Gemini data-use terms](https://ai.google.dev/gemini-api/terms).
