# Developing features independently

Use one public branch and one pull request for each independently releasable
feature. Start from the current `origin/main`, with a separate Git worktree
when another feature is already being developed locally.

For example, the Android widget uses `codex/android-glucose-widget`, based on
`main`. Garmin remains on `codex/garmin-companion-beta`. Neither feature branch
needs to contain the other's changes.

1. Fetch `origin`, create the feature branch from `origin/main`, and make the
   change in its own worktree.
2. Push the branch and open a draft PR targeting `main`. This makes the work
   public while clearly marking it as unfinished. Use synthetic data for public
   evidence; keep personal screenshots and local QA captures out of Git.
3. Run the relevant local checks and GitHub Actions. Test Android changes in an
   emulator before installing a build on an authorised development device.
4. Merge only the feature that has completed review and validation. Other
   feature branches remain separate.
5. Prepare the next official release from `main` using the existing protected
   release workflow. It can include the widget while Garmin is still in beta.
   Bring the updated `main` into the Garmin branch later and resolve conflicts
   there, when continuing Garmin work.

Publishing a branch or PR does not update anyone's installed app. A phone runs
the code in its installed APK. Record the commit used to build each test APK;
do not build a widget test from the Garmin branch or combine both branches just
to obtain a test build.

Debug builds already use the separate `.dev` application ID, so they cannot
replace the official installation and do not share its private data. They need
their own test setup. An official update should use the reviewed, signed release
path described in [Releasing](RELEASING.md).

## Widget validation

Check the default four-by-two card and larger sizes; resize an existing instance and rotate
the launcher. Verify mmol/L and mg/dL, large text, calculated trends, configured
range colours, delayed/stale/missing readings, tap-to-open, and data clearing.
The history trace uses up to four hours of observed readings, with gaps over
12 minutes left disconnected. Its duration label describes the available
history, not an assumed full window.

History is retained inside the existing encrypted display snapshot. Old
snapshots without history remain readable; a subsequent glucose sync supplies
the trace. Clearing the snapshot clears its history too. Validate recovery
after process death and reboot, as well as a launcher update over the previous
official widget, before releasing.

The native card uses the same JSON design, theme, glucose-colour and trend
presentation definitions as Today. Widget history is supplied before the Wear
payload limit, so a minute-by-minute source retains the full four-hour trace.
The widget collector uses the existing privacy epoch and encrypted snapshot;
adding a widget does not enable the prominent glucose notification or AOD.
