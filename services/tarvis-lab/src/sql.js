import { HttpError } from "./errors.js";

const MAX_SQL_CHARACTERS = 12_000;
const DEFAULT_MAX_ROWS = 200;
const DEFAULT_MAX_RESULT_CHARACTERS = 60_000;

const FORBIDDEN_TOKENS = new Set([
  "alter",
  "analyze",
  "attach",
  "create",
  "cross",
  "delete",
  "detach",
  "drop",
  "insert",
  "load_extension",
  "pragma",
  "recursive",
  "reindex",
  "replace",
  "update",
  "vacuum",
]);

const FORBIDDEN_FUNCTIONS = new Set([
  "load_extension",
  "randomblob",
  "readfile",
  "writefile",
  "zeroblob",
]);

function scanSql(sql) {
  let normalized = "";
  let state = "plain";
  let semicolonCount = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (state === "single") {
      if (current === "'" && next === "'") {
        normalized += "  ";
        index += 1;
      } else if (current === "'") {
        normalized += " ";
        state = "plain";
      } else {
        normalized += " ";
      }
      continue;
    }

    if (state === "double") {
      if (current === '"' && next === '"') {
        normalized += "  ";
        index += 1;
      } else if (current === '"') {
        normalized += " ";
        state = "plain";
      } else {
        normalized += /[A-Za-z0-9_]/u.test(current) ? current : " ";
      }
      continue;
    }

    if (state === "bracket") {
      if (current === "]") {
        state = "plain";
      }
      normalized += /[A-Za-z0-9_]/u.test(current) ? current : " ";
      continue;
    }

    if (state === "backtick") {
      if (current === "`") {
        state = "plain";
      }
      normalized += /[A-Za-z0-9_]/u.test(current) ? current : " ";
      continue;
    }

    if (state === "line_comment") {
      if (current === "\n" || current === "\r") {
        state = "plain";
      }
      normalized += " ";
      continue;
    }

    if (state === "block_comment") {
      if (current === "*" && next === "/") {
        normalized += "  ";
        index += 1;
        state = "plain";
      } else {
        normalized += " ";
      }
      continue;
    }

    if (current === "'") {
      state = "single";
      normalized += " ";
    } else if (current === '"') {
      state = "double";
      normalized += " ";
    } else if (current === "[") {
      state = "bracket";
      normalized += " ";
    } else if (current === "`") {
      state = "backtick";
      normalized += " ";
    } else if (current === "-" && next === "-") {
      state = "line_comment";
      normalized += "  ";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "block_comment";
      normalized += "  ";
      index += 1;
    } else {
      if (current === ";") {
        semicolonCount += 1;
      }
      normalized += current;
    }
  }

  if (["single", "double", "bracket", "backtick", "block_comment"].includes(state)) {
    throw new HttpError(400, "invalid_sql", "The analysis query contains an unterminated token.");
  }

  return { normalized, semicolonCount };
}

export function validateReadonlySql(input) {
  if (typeof input !== "string") {
    throw new HttpError(400, "invalid_sql", "The analysis query must be text.");
  }
  const sql = input.trim();
  if (sql.length === 0 || sql.length > MAX_SQL_CHARACTERS) {
    throw new HttpError(400, "invalid_sql", "The analysis query has an invalid length.");
  }

  const { normalized, semicolonCount } = scanSql(sql);
  const withoutTrailingSemicolon = normalized.replace(/;\s*$/u, "");
  if (semicolonCount > (withoutTrailingSemicolon.length === normalized.length ? 0 : 1)) {
    throw new HttpError(400, "unsafe_sql", "Only one read-only analysis statement is allowed.");
  }

  const tokens = withoutTrailingSemicolon.toLowerCase().match(/[a-z_][a-z0-9_]*/gu) ?? [];
  if (tokens.length === 0 || !["select", "with"].includes(tokens[0])) {
    throw new HttpError(400, "unsafe_sql", "Only SELECT analysis queries are allowed.");
  }
  for (const token of tokens) {
    if (FORBIDDEN_TOKENS.has(token)) {
      throw new HttpError(400, "unsafe_sql", "The analysis query is not read-only.");
    }
    if (token.startsWith("sqlite_") || token.startsWith("pragma_")) {
      throw new HttpError(400, "unsafe_sql", "SQLite internal tables are not available.");
    }
  }

  const functionMatches = withoutTrailingSemicolon
    .toLowerCase()
    .matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gu);
  for (const match of functionMatches) {
    if (FORBIDDEN_FUNCTIONS.has(match[1])) {
      throw new HttpError(400, "unsafe_sql", "The analysis query uses a disabled function.");
    }
  }

  return sql.replace(/;\s*$/u, "");
}

function jsonSafeValue(value) {
  if (typeof value === "bigint") {
    return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Uint8Array) {
    return "[binary value omitted]";
  }
  return value;
}

export function executeReadonlyQuery(
  database,
  sqlInput,
  {
    maxRows = DEFAULT_MAX_ROWS,
    maxResultCharacters = DEFAULT_MAX_RESULT_CHARACTERS,
  } = {},
) {
  const sql = validateReadonlySql(sqlInput);
  const wrappedSql = `SELECT * FROM (${sql}) AS __tarvis_result LIMIT ${maxRows + 1}`;

  let statement;
  try {
    statement = database.prepare(wrappedSql);
  } catch (error) {
    throw new HttpError(400, "query_invalid", "The analysis query could not be prepared.", {
      cause: error,
    });
  }

  const rows = [];
  let resultCharacters = 0;
  let truncated = false;
  try {
    for (const rawRow of statement.iterate()) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      const row = Object.fromEntries(
        Object.entries(rawRow).map(([key, value]) => [key, jsonSafeValue(value)]),
      );
      const characters = JSON.stringify(row).length;
      if (resultCharacters + characters > maxResultCharacters) {
        truncated = true;
        break;
      }
      rows.push(row);
      resultCharacters += characters;
    }
  } catch (error) {
    throw new HttpError(400, "query_failed", "The read-only analysis query failed.", {
      cause: error,
    });
  }

  return {
    columns: statement.columns().map((column) => column.name),
    rows,
    rowCount: rows.length,
    truncated,
  };
}
