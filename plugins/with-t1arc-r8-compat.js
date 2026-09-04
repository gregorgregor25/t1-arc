const { withAppBuildGradle } = require('expo/config-plugins');

const PROGUARD_ANCHOR =
  'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"';
const T1ARC_RULES =
  "rootProject.file('../scripts/gradle/t1arc-r8-compat.pro')";

function occurrenceCount(contents, value) {
  return contents.split(value).length - 1;
}

function matchingBrace(contents, openingBrace, limit) {
  let depth = 0;
  let quote;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < limit; index += 1) {
    const character = contents[index];
    const next = contents[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function uniqueNamedBlock(contents, name, start = 0, end = contents.length) {
  const scope = contents.slice(start, end);
  const matches = [
    ...scope.matchAll(new RegExp(`(?:^|\\r?\\n)[\\t ]*${name}[\\t ]*\\{`, 'g')),
  ];
  if (matches.length !== 1) return undefined;
  const declaration = start + (matches[0].index ?? 0);
  const openingBrace = contents.indexOf('{', declaration);
  const closingBrace = matchingBrace(contents, openingBrace, end);
  if (openingBrace < 0 || closingBrace < 0) return undefined;
  return { start: openingBrace + 1, end: closingBrace };
}

function isActiveGroovyCode(contents, position) {
  let quote;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < position; index += 1) {
    const character = contents[index];
    const next = contents[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    }
  }
  return !quote && !lineComment && !blockComment;
}

function injectT1ArcR8Compat(contents) {
  const anchorCount = occurrenceCount(contents, PROGUARD_ANCHOR);
  if (anchorCount === 0) {
    throw new Error(
      'T1 Arc could not locate the generated Android ProGuard configuration.',
    );
  }
  if (anchorCount !== 1) {
    throw new Error(
      'T1 Arc requires one unique generated Android ProGuard configuration anchor.',
    );
  }

  const buildTypes = uniqueNamedBlock(contents, 'buildTypes');
  const release = buildTypes
    ? uniqueNamedBlock(contents, 'release', buildTypes.start, buildTypes.end)
    : undefined;
  const anchorIndex = contents.indexOf(PROGUARD_ANCHOR);
  const lineStart = contents.lastIndexOf('\n', anchorIndex) + 1;
  if (
    !release ||
    anchorIndex < release.start ||
    anchorIndex >= release.end ||
    !/^[\t ]*$/.test(contents.slice(lineStart, anchorIndex)) ||
    !isActiveGroovyCode(contents, anchorIndex)
  ) {
    throw new Error(
      'T1 Arc requires one active generated ProGuard configuration inside the release build type.',
    );
  }

  const linkedConfiguration = `${PROGUARD_ANCHOR}, ${T1ARC_RULES}`;
  const rulesCount = occurrenceCount(contents, T1ARC_RULES);
  if (contents.includes(linkedConfiguration)) {
    if (rulesCount !== 1) {
      throw new Error(
        'T1 Arc found duplicate Android R8 compatibility rule links.',
      );
    }
    return contents;
  }
  if (rulesCount !== 0) {
    throw new Error(
      'T1 Arc found its Android R8 rules outside the expected ProGuard declaration.',
    );
  }
  return contents.replace(
    PROGUARD_ANCHOR,
    linkedConfiguration,
  );
}

function withT1ArcR8Compat(config) {
  return withAppBuildGradle(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'groovy') {
      throw new Error(
        'T1 Arc R8 compatibility currently expects a Groovy app build file.',
      );
    }
    androidConfig.modResults.contents = injectT1ArcR8Compat(
      androidConfig.modResults.contents,
    );
    return androidConfig;
  });
}

module.exports = withT1ArcR8Compat;
module.exports.injectT1ArcR8Compat = injectT1ArcR8Compat;
