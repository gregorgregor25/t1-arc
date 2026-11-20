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

if ! grep -Eq "Could not resolve all (artifacts|dependencies) for configuration 'classpath'[.]" "$log"; then
  exit "$status"
fi

missing_published_dependency() {
  local repository=$1 coordinate group artifact version pom
  shift
  for coordinate in "$@"; do
    IFS=: read -r group artifact version <<< "$coordinate"
    pom="${group//./\/}/$artifact/$version/$artifact-$version.pom"
    if grep -Fq "> Could not find $coordinate." "$log" && grep -Fq "$repository/$pom" "$log"; then
      return 0
    fi
  done
  return 1
}

plugin_download_failed() {
  if grep -Fq "Error resolving plugin [id: 'com.facebook.react.settings']" "$log" &&
     missing_published_dependency https://repo.maven.apache.org/maven2 \
       org.jetbrains.kotlin:kotlin-stdlib:2.2.21 org.jetbrains.kotlin:kotlin-gradle-plugins-bom:2.1.20 \
       io.github.java-diff-utils:java-diff-utils:4.15; then
    return 0
  fi
  # The Expo module's project plugin imports its Kotlin BOM through the portal.
  if grep -Fq "buildscript of project ':expo-module-gradle-plugin' > org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin:2.1.20" "$log" &&
     missing_published_dependency https://plugins.gradle.org/m2 org.jetbrains.kotlin:kotlin-gradle-plugins-bom:2.1.20; then
    return 0
  fi
  # The root settings file consumes the plugins after their included builds compile.
  grep -Eq "settings file 'settings[.]gradle' > project :(gradle-plugin:settings-plugin|expo-gradle-plugin:expo-autolinking-settings-plugin)( > |$)" "$log" &&
    missing_published_dependency https://plugins.gradle.org/m2 \
      org.jetbrains.kotlin:kotlin-stdlib:2.1.20 com.google.code.gson:gson:2.8.9 \
      com.google.guava:guava:31.0.1-jre com.squareup:javapoet:1.13.0 \
      org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3
}

if ! plugin_download_failed; then exit "$status"; fi

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
