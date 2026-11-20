#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?The guarded bundle retry runs in GitHub Actions.}"
: "${GITHUB_WORKSPACE:?}"
: "${GITHUB_ENV:?}"

command=(./gradlew :app:createBundleReleaseJsAndAssets --no-build-cache --no-daemon)
log="$RUNNER_TEMP/t1arc-guarded-bundle.log"
if "${command[@]}" 2>&1 | tee "$log"; then
  exit 0
else
  pipeline_status=("${PIPESTATUS[@]}")
  status=${pipeline_status[0]}
fi
# A partial log cannot justify a dependency retry.
if (( pipeline_status[1] != 0 )); then exit "${pipeline_status[1]}"; fi

if ! grep -Fq "Error resolving plugin [id: 'com.facebook.react.settings']" "$log"; then
  exit "$status"
fi
if ! grep -Fq "Could not resolve all artifacts for configuration 'classpath'." "$log"; then
  exit "$status"
fi

missing_central_dependency=false
while IFS='|' read -r coordinate pom; do
  if grep -Fq "> Could not find $coordinate." "$log" &&
     grep -Fq "https://repo.maven.apache.org/maven2/$pom" "$log"; then
    missing_central_dependency=true
  fi
done <<'DEPENDENCIES'
org.jetbrains.kotlin:kotlin-stdlib:2.2.21|org/jetbrains/kotlin/kotlin-stdlib/2.2.21/kotlin-stdlib-2.2.21.pom
org.jetbrains.kotlin:kotlin-gradle-plugins-bom:2.1.20|org/jetbrains/kotlin/kotlin-gradle-plugins-bom/2.1.20/kotlin-gradle-plugins-bom-2.1.20.pom
io.github.java-diff-utils:java-diff-utils:4.15|io/github/java-diff-utils/java-diff-utils/4.15/java-diff-utils-4.15.pom
DEPENDENCIES
if [[ "$missing_central_dependency" != true ]]; then exit "$status"; fi

# Init scripts also reach React Native and Expo's included Gradle builds.
# The always-run workflow cleanup removes this file before caches are saved.
init_dir="${GRADLE_USER_HOME:-$HOME/.gradle}/init.d"
init_script="$init_dir/t1arc-ci-central-mirror.init.gradle"
if [[ -e "$init_script" ]]; then
  echo "Refusing to replace an existing Gradle initialization script." >&2
  exit "$status"
fi
mkdir -p "$init_dir"
cp "$GITHUB_WORKSPACE/scripts/gradle/t1arc-ci-central-mirror.init.gradle" "$init_script"
printf 'T1ARC_CI_CENTRAL_MIRROR_ENABLED=1\n' >> "$GITHUB_ENV"
echo "::notice::Retrying the guarded bundle once through Google's HTTPS Maven Central mirror."
"${command[@]}"
