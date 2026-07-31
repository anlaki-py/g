// tui/src/index.ts
import { Marked as Marked2 } from "marked";

// tui/src/autocomplete.ts
import { spawn } from "child_process";
import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";

// tui/src/fuzzy.ts
function fuzzyMatch(query, text) {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const matchQuery = (normalizedQuery) => {
    if (normalizedQuery.length === 0) {
      return { matches: true, score: 0 };
    }
    if (normalizedQuery.length > textLower.length) {
      return { matches: false, score: 0 };
    }
    let queryIndex = 0;
    let score = 0;
    let lastMatchIndex = -1;
    let consecutiveMatches = 0;
    for (let i = 0; i < textLower.length && queryIndex < normalizedQuery.length; i++) {
      if (textLower[i] === normalizedQuery[queryIndex]) {
        const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]);
        if (lastMatchIndex === i - 1) {
          consecutiveMatches++;
          score -= consecutiveMatches * 5;
        } else {
          consecutiveMatches = 0;
          if (lastMatchIndex >= 0) {
            score += (i - lastMatchIndex - 1) * 2;
          }
        }
        if (isWordBoundary) {
          score -= 10;
        }
        score += i * 0.1;
        lastMatchIndex = i;
        queryIndex++;
      }
    }
    if (queryIndex < normalizedQuery.length) {
      return { matches: false, score: 0 };
    }
    if (normalizedQuery === textLower) {
      score -= 100;
    }
    return { matches: true, score };
  };
  const primaryMatch = matchQuery(queryLower);
  if (primaryMatch.matches) {
    return primaryMatch;
  }
  const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
  const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
  const swappedQuery = alphaNumericMatch ? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}` : numericAlphaMatch ? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}` : "";
  if (!swappedQuery) {
    return primaryMatch;
  }
  const swappedMatch = matchQuery(swappedQuery);
  if (!swappedMatch.matches) {
    return primaryMatch;
  }
  return { matches: true, score: swappedMatch.score + 5 };
}
function fuzzyFilter(items, query, getText) {
  if (!query.trim()) {
    return items;
  }
  const tokens = query.trim().split(/[\s/]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return items;
  }
  const results = [];
  for (const item of items) {
    const text = getText(item);
    let totalScore = 0;
    let allMatch = true;
    for (const token of tokens) {
      const match = fuzzyMatch(token, text);
      if (match.matches) {
        totalScore += match.score;
      } else {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      results.push({ item, totalScore });
    }
  }
  results.sort((a, b) => a.totalScore - b.totalScore);
  return results.map((r) => r.item);
}

// tui/src/autocomplete.ts
var PATH_DELIMITERS = /* @__PURE__ */ new Set([" ", "	", '"', "'", "="]);
function toDisplayPath(value) {
  return value.replace(/\\/g, "/");
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildFdPathQuery(query) {
  const normalized = toDisplayPath(query);
  if (!normalized.includes("/")) {
    return normalized;
  }
  const hasTrailingSeparator = normalized.endsWith("/");
  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return normalized;
  }
  const separatorPattern = "[\\\\/]";
  const segments = trimmed.split("/").filter(Boolean).map((segment) => escapeRegex(segment));
  if (segments.length === 0) {
    return normalized;
  }
  let pattern = segments.join(separatorPattern);
  if (hasTrailingSeparator) {
    pattern += separatorPattern;
  }
  return pattern;
}
function findLastDelimiter(text) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (PATH_DELIMITERS.has(text[i] ?? "")) {
      return i;
    }
  }
  return -1;
}
function findUnclosedQuoteStart(text) {
  let inQuotes = false;
  let quoteStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') {
      inQuotes = !inQuotes;
      if (inQuotes) {
        quoteStart = i;
      }
    }
  }
  return inQuotes ? quoteStart : null;
}
function isTokenStart(text, index) {
  return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}
function extractQuotedPrefix(text) {
  const quoteStart = findUnclosedQuoteStart(text);
  if (quoteStart === null) {
    return null;
  }
  if (quoteStart > 0 && text[quoteStart - 1] === "@") {
    if (!isTokenStart(text, quoteStart - 1)) {
      return null;
    }
    return text.slice(quoteStart - 1);
  }
  if (!isTokenStart(text, quoteStart)) {
    return null;
  }
  return text.slice(quoteStart);
}
function parsePathPrefix(prefix) {
  if (prefix.startsWith('@"')) {
    return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
  }
  if (prefix.startsWith('"')) {
    return { rawPrefix: prefix.slice(1), isAtPrefix: false, isQuotedPrefix: true };
  }
  if (prefix.startsWith("@")) {
    return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
  }
  return { rawPrefix: prefix, isAtPrefix: false, isQuotedPrefix: false };
}
function buildCompletionValue(path5, options) {
  const needsQuotes = options.isQuotedPrefix || path5.includes(" ");
  const prefix = options.isAtPrefix ? "@" : "";
  if (!needsQuotes) {
    return `${prefix}${path5}`;
  }
  const openQuote = `${prefix}"`;
  const closeQuote = '"';
  return `${openQuote}${path5}${closeQuote}`;
}
async function walkDirectoryWithFd(baseDir, fdPath, query, maxResults, signal) {
  const args = [
    "--base-directory",
    baseDir,
    "--max-results",
    String(maxResults),
    "--type",
    "f",
    "--type",
    "d",
    "--follow",
    "--hidden",
    "--exclude",
    ".git",
    "--exclude",
    ".git/*",
    "--exclude",
    ".git/**"
  ];
  if (toDisplayPath(query).includes("/")) {
    args.push("--full-path");
  }
  if (query) {
    args.push(buildFdPathQuery(query));
  }
  return await new Promise((resolve) => {
    if (signal.aborted) {
      resolve([]);
      return;
    }
    const child = spawn(fdPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let resolved = false;
    const finish = (results) => {
      if (resolved) return;
      resolved = true;
      signal.removeEventListener("abort", onAbort);
      resolve(results);
    };
    const onAbort = () => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => {
      finish([]);
    });
    child.on("close", (code) => {
      if (signal.aborted || code !== 0 || !stdout) {
        finish([]);
        return;
      }
      const lines = stdout.trim().split("\n").filter(Boolean);
      const results = [];
      for (const line of lines) {
        const displayLine = toDisplayPath(line);
        const hasTrailingSeparator = displayLine.endsWith("/");
        const normalizedPath = hasTrailingSeparator ? displayLine.slice(0, -1) : displayLine;
        if (normalizedPath === ".git" || normalizedPath.startsWith(".git/") || normalizedPath.includes("/.git/")) {
          continue;
        }
        results.push({
          path: displayLine,
          isDirectory: hasTrailingSeparator
        });
      }
      finish(results);
    });
  });
}
var CombinedAutocompleteProvider = class {
  commands;
  basePath;
  fdPath;
  constructor(commands = [], basePath, fdPath = null) {
    this.commands = commands;
    this.basePath = basePath;
    this.fdPath = fdPath;
  }
  async getSuggestions(lines, cursorLine, cursorCol, options) {
    const currentLine = lines[cursorLine] || "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    const atPrefix = this.extractAtPrefix(textBeforeCursor);
    if (atPrefix) {
      const { rawPrefix, isQuotedPrefix } = parsePathPrefix(atPrefix);
      const suggestions2 = await this.getFuzzyFileSuggestions(rawPrefix, {
        isQuotedPrefix,
        signal: options.signal
      });
      if (suggestions2.length === 0) return null;
      return {
        items: suggestions2,
        prefix: atPrefix
      };
    }
    if (!options.force && textBeforeCursor.startsWith("/")) {
      const spaceIndex = textBeforeCursor.indexOf(" ");
      if (spaceIndex === -1) {
        const prefix = textBeforeCursor.slice(1);
        const commandItems = this.commands.map((cmd) => {
          const name = "name" in cmd ? cmd.name : cmd.value;
          const hint = "argumentHint" in cmd && cmd.argumentHint ? cmd.argumentHint : void 0;
          const desc = cmd.description ?? "";
          const fullDesc = hint ? desc ? `${hint} \u2014 ${desc}` : hint : desc;
          return {
            name,
            label: name,
            description: fullDesc || void 0
          };
        });
        const filtered = fuzzyFilter(commandItems, prefix, (item) => item.name).map((item) => ({
          value: item.name,
          label: item.label,
          ...item.description && { description: item.description }
        }));
        if (filtered.length === 0) return null;
        return {
          items: filtered,
          prefix: textBeforeCursor
        };
      }
      const commandName = textBeforeCursor.slice(1, spaceIndex);
      const argumentText = textBeforeCursor.slice(spaceIndex + 1);
      const command = this.commands.find((cmd) => {
        const name = "name" in cmd ? cmd.name : cmd.value;
        return name === commandName;
      });
      if (!command || !("getArgumentCompletions" in command) || !command.getArgumentCompletions) {
        return null;
      }
      const argumentSuggestions = await command.getArgumentCompletions(argumentText);
      if (!Array.isArray(argumentSuggestions) || argumentSuggestions.length === 0) {
        return null;
      }
      return {
        items: argumentSuggestions,
        prefix: argumentText
      };
    }
    const pathMatch = this.extractPathPrefix(textBeforeCursor, options.force ?? false);
    if (pathMatch === null) {
      return null;
    }
    const suggestions = this.getFileSuggestions(pathMatch);
    if (suggestions.length === 0) return null;
    return {
      items: suggestions,
      prefix: pathMatch
    };
  }
  applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
    const currentLine = lines[cursorLine] || "";
    const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
    const afterCursor = currentLine.slice(cursorCol);
    const isQuotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"');
    const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
    const hasTrailingQuoteInItem = item.value.endsWith('"');
    const adjustedAfterCursor = isQuotedPrefix && hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
    const isSlashCommand = prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/");
    if (isSlashCommand) {
      const newLine2 = `${beforePrefix}/${item.value} ${adjustedAfterCursor}`;
      const newLines2 = [...lines];
      newLines2[cursorLine] = newLine2;
      return {
        lines: newLines2,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + 2
        // +2 for "/" and space
      };
    }
    if (prefix.startsWith("@")) {
      const isDirectory2 = item.label.endsWith("/");
      const suffix = isDirectory2 ? "" : " ";
      const newLine2 = `${beforePrefix + item.value}${suffix}${adjustedAfterCursor}`;
      const newLines2 = [...lines];
      newLines2[cursorLine] = newLine2;
      const hasTrailingQuote2 = item.value.endsWith('"');
      const cursorOffset2 = isDirectory2 && hasTrailingQuote2 ? item.value.length - 1 : item.value.length;
      return {
        lines: newLines2,
        cursorLine,
        cursorCol: beforePrefix.length + cursorOffset2 + suffix.length
      };
    }
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    if (textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")) {
      const newLine2 = beforePrefix + item.value + adjustedAfterCursor;
      const newLines2 = [...lines];
      newLines2[cursorLine] = newLine2;
      const isDirectory2 = item.label.endsWith("/");
      const hasTrailingQuote2 = item.value.endsWith('"');
      const cursorOffset2 = isDirectory2 && hasTrailingQuote2 ? item.value.length - 1 : item.value.length;
      return {
        lines: newLines2,
        cursorLine,
        cursorCol: beforePrefix.length + cursorOffset2
      };
    }
    const newLine = beforePrefix + item.value + adjustedAfterCursor;
    const newLines = [...lines];
    newLines[cursorLine] = newLine;
    const isDirectory = item.label.endsWith("/");
    const hasTrailingQuote = item.value.endsWith('"');
    const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;
    return {
      lines: newLines,
      cursorLine,
      cursorCol: beforePrefix.length + cursorOffset
    };
  }
  // Extract @ prefix for fuzzy file suggestions
  extractAtPrefix(text) {
    const quotedPrefix = extractQuotedPrefix(text);
    if (quotedPrefix?.startsWith('@"')) {
      return quotedPrefix;
    }
    const lastDelimiterIndex = findLastDelimiter(text);
    const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
    if (text[tokenStart] === "@") {
      return text.slice(tokenStart);
    }
    return null;
  }
  // Extract a path-like prefix from the text before cursor
  extractPathPrefix(text, forceExtract = false) {
    const quotedPrefix = extractQuotedPrefix(text);
    if (quotedPrefix) {
      return quotedPrefix;
    }
    const lastDelimiterIndex = findLastDelimiter(text);
    const pathPrefix = lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1);
    if (forceExtract) {
      return pathPrefix;
    }
    if (pathPrefix.includes("/") || pathPrefix.startsWith(".") || pathPrefix.startsWith("~/")) {
      return pathPrefix;
    }
    if (pathPrefix === "" && text.endsWith(" ")) {
      return pathPrefix;
    }
    return null;
  }
  // Expand home directory (~/) to actual home path
  expandHomePath(path5) {
    if (path5.startsWith("~/")) {
      const expandedPath = join(homedir(), path5.slice(2));
      return path5.endsWith("/") && !expandedPath.endsWith("/") ? `${expandedPath}/` : expandedPath;
    } else if (path5 === "~") {
      return homedir();
    }
    return path5;
  }
  resolveScopedFuzzyQuery(rawQuery) {
    const normalizedQuery = toDisplayPath(rawQuery);
    const slashIndex = normalizedQuery.lastIndexOf("/");
    if (slashIndex === -1) {
      return null;
    }
    const displayBase = normalizedQuery.slice(0, slashIndex + 1);
    const query = normalizedQuery.slice(slashIndex + 1);
    let baseDir;
    if (displayBase.startsWith("~/")) {
      baseDir = this.expandHomePath(displayBase);
    } else if (displayBase.startsWith("/")) {
      baseDir = displayBase;
    } else {
      baseDir = join(this.basePath, displayBase);
    }
    try {
      if (!statSync(baseDir).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
    return { baseDir, query, displayBase };
  }
  scopedPathForDisplay(displayBase, relativePath) {
    const normalizedRelativePath = toDisplayPath(relativePath);
    if (displayBase === "/") {
      return `/${normalizedRelativePath}`;
    }
    return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
  }
  // Get file/directory suggestions for a given path prefix
  getFileSuggestions(prefix) {
    try {
      let searchDir;
      let searchPrefix;
      const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(prefix);
      let expandedPrefix = rawPrefix;
      if (expandedPrefix.startsWith("~")) {
        expandedPrefix = this.expandHomePath(expandedPrefix);
      }
      const isRootPrefix = rawPrefix === "" || rawPrefix === "./" || rawPrefix === "../" || rawPrefix === "~" || rawPrefix === "~/" || rawPrefix === "/" || isAtPrefix && rawPrefix === "";
      if (isRootPrefix) {
        if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) {
          searchDir = expandedPrefix;
        } else {
          searchDir = join(this.basePath, expandedPrefix);
        }
        searchPrefix = "";
      } else if (rawPrefix.endsWith("/")) {
        if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) {
          searchDir = expandedPrefix;
        } else {
          searchDir = join(this.basePath, expandedPrefix);
        }
        searchPrefix = "";
      } else {
        const dir = dirname(expandedPrefix);
        const file = basename(expandedPrefix);
        if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) {
          searchDir = dir;
        } else {
          searchDir = join(this.basePath, dir);
        }
        searchPrefix = file;
      }
      const entries = readdirSync(searchDir, { withFileTypes: true });
      const suggestions = [];
      for (const entry of entries) {
        if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) {
          continue;
        }
        let isDirectory = entry.isDirectory();
        if (!isDirectory && entry.isSymbolicLink()) {
          try {
            const fullPath = join(searchDir, entry.name);
            isDirectory = statSync(fullPath).isDirectory();
          } catch {
          }
        }
        let relativePath;
        const name = entry.name;
        const displayPrefix = rawPrefix;
        if (displayPrefix.endsWith("/")) {
          relativePath = displayPrefix + name;
        } else if (displayPrefix.includes("/") || displayPrefix.includes("\\")) {
          if (displayPrefix.startsWith("~/")) {
            const homeRelativeDir = displayPrefix.slice(2);
            const dir = dirname(homeRelativeDir);
            relativePath = `~/${dir === "." ? name : join(dir, name)}`;
          } else if (displayPrefix.startsWith("/")) {
            const dir = dirname(displayPrefix);
            if (dir === "/") {
              relativePath = `/${name}`;
            } else {
              relativePath = `${dir}/${name}`;
            }
          } else {
            relativePath = join(dirname(displayPrefix), name);
            if (displayPrefix.startsWith("./") && !relativePath.startsWith("./")) {
              relativePath = `./${relativePath}`;
            }
          }
        } else {
          if (displayPrefix.startsWith("~")) {
            relativePath = `~/${name}`;
          } else {
            relativePath = name;
          }
        }
        relativePath = toDisplayPath(relativePath);
        const pathValue = isDirectory ? `${relativePath}/` : relativePath;
        const value = buildCompletionValue(pathValue, {
          isDirectory,
          isAtPrefix,
          isQuotedPrefix
        });
        suggestions.push({
          value,
          label: name + (isDirectory ? "/" : "")
        });
      }
      suggestions.sort((a, b) => {
        const aIsDir = a.value.endsWith("/");
        const bIsDir = b.value.endsWith("/");
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.label.localeCompare(b.label);
      });
      return suggestions;
    } catch (_e) {
      return [];
    }
  }
  // Score an entry against the query (higher = better match)
  // isDirectory adds bonus to prioritize folders
  scoreEntry(filePath, query, isDirectory) {
    const fileName = basename(filePath);
    const lowerFileName = fileName.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let score = 0;
    if (lowerFileName === lowerQuery) score = 100;
    else if (lowerFileName.startsWith(lowerQuery)) score = 80;
    else if (lowerFileName.includes(lowerQuery)) score = 50;
    else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;
    if (isDirectory && score > 0) score += 10;
    return score;
  }
  // Fuzzy file search using fd (fast, respects .gitignore)
  async getFuzzyFileSuggestions(query, options) {
    if (!this.fdPath || options.signal.aborted) {
      return [];
    }
    try {
      const scopedQuery = this.resolveScopedFuzzyQuery(query);
      const fdBaseDir = scopedQuery?.baseDir ?? this.basePath;
      const fdQuery = scopedQuery?.query ?? query;
      const entries = await walkDirectoryWithFd(fdBaseDir, this.fdPath, fdQuery, 100, options.signal);
      if (options.signal.aborted) {
        return [];
      }
      const scoredEntries = entries.map((entry) => ({
        ...entry,
        score: fdQuery ? this.scoreEntry(entry.path, fdQuery, entry.isDirectory) : 1
      })).filter((entry) => entry.score > 0);
      scoredEntries.sort((a, b) => b.score - a.score);
      const topEntries = scoredEntries.slice(0, 20);
      const suggestions = [];
      for (const { path: entryPath, isDirectory } of topEntries) {
        const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath;
        const displayPath = scopedQuery ? this.scopedPathForDisplay(scopedQuery.displayBase, pathWithoutSlash) : pathWithoutSlash;
        const entryName = basename(pathWithoutSlash);
        const completionPath = isDirectory ? `${displayPath}/` : displayPath;
        const value = buildCompletionValue(completionPath, {
          isDirectory,
          isAtPrefix: true,
          isQuotedPrefix: options.isQuotedPrefix
        });
        suggestions.push({
          value,
          label: entryName + (isDirectory ? "/" : ""),
          description: displayPath
        });
      }
      return suggestions;
    } catch {
      return [];
    }
  }
  // Check if we should trigger file completion (called on Tab key)
  shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
    const currentLine = lines[cursorLine] || "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
      return false;
    }
    return true;
  }
};

// tui/src/utils.ts
import { eastAsianWidth } from "get-east-asian-width";
var graphemeSegmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
var wordSegmenter = new Intl.Segmenter(void 0, { granularity: "word" });
function getGraphemeSegmenter() {
  return graphemeSegmenter;
}
function getWordSegmenter() {
  return wordSegmenter;
}
function couldBeEmoji(segment) {
  const cp = segment.codePointAt(0);
  return cp >= 126976 && cp <= 130047 || // Emoji and Pictograph
  cp >= 8960 && cp <= 9215 || // Misc technical
  cp >= 9728 && cp <= 10175 || // Misc symbols, dingbats
  cp >= 11088 && cp <= 11093 || // Specific stars/circles
  segment.includes("\uFE0F") || // Contains VS16 (emoji presentation selector)
  segment.length > 2;
}
var zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
var leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
var nonPrintingCharRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Format}|\p{Mark}|\p{Surrogate})$/v;
var markCharRegex = /^\p{Mark}$/v;
var terminalSpacingMarkRegex = /^(?:[\p{Spacing_Mark}--[\u1734\u302E\u302F]]|[\u065F\u0F7F\u102B\u102C\u1031\u1033-\u1035\u1038\u103A-\u103E])+$/v;
var rgiEmojiRegex = /^\p{RGI_Emoji}$/v;
var WIDTH_CACHE_SIZE = 512;
var widthCache = /* @__PURE__ */ new Map();
var cjkBreakRegex = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
function isPrintableAscii(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 32 || code > 126) {
      return false;
    }
  }
  return true;
}
function truncateFragmentToWidth(text, maxWidth) {
  if (maxWidth <= 0 || text.length === 0) {
    return { text: "", width: 0 };
  }
  if (isPrintableAscii(text)) {
    const clipped = text.slice(0, maxWidth);
    return { text: clipped, width: clipped.length };
  }
  const hasAnsi = text.includes("\x1B");
  const hasTabs = text.includes("	");
  if (!hasAnsi && !hasTabs) {
    let result2 = "";
    let width2 = 0;
    for (const { segment } of graphemeSegmenter.segment(text)) {
      const w = graphemeWidth(segment);
      if (width2 + w > maxWidth) {
        break;
      }
      result2 += segment;
      width2 += w;
    }
    return { text: result2, width: width2 };
  }
  let result = "";
  let width = 0;
  let i = 0;
  let pendingAnsi = "";
  while (i < text.length) {
    const ansi = extractAnsiCode(text, i);
    if (ansi) {
      pendingAnsi += ansi.code;
      i += ansi.length;
      continue;
    }
    if (text[i] === "	") {
      if (width + 3 > maxWidth) {
        break;
      }
      if (pendingAnsi) {
        result += pendingAnsi;
        pendingAnsi = "";
      }
      result += "	";
      width += 3;
      i++;
      continue;
    }
    let end = i;
    while (end < text.length && text[end] !== "	") {
      const nextAnsi = extractAnsiCode(text, end);
      if (nextAnsi) {
        break;
      }
      end++;
    }
    for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
      const w = graphemeWidth(segment);
      if (width + w > maxWidth) {
        return { text: result, width };
      }
      if (pendingAnsi) {
        result += pendingAnsi;
        pendingAnsi = "";
      }
      result += segment;
      width += w;
    }
    i = end;
  }
  return { text: result, width };
}
function finalizeTruncatedResult(prefix, prefixWidth, ellipsis, ellipsisWidth, maxWidth, pad) {
  const reset = "\x1B[0m";
  const visibleWidth2 = prefixWidth + ellipsisWidth;
  let result;
  if (ellipsis.length > 0) {
    result = `${prefix}${reset}${ellipsis}${reset}`;
  } else {
    result = `${prefix}${reset}`;
  }
  return pad ? result + " ".repeat(Math.max(0, maxWidth - visibleWidth2)) : result;
}
function graphemeWidth(segment) {
  if (segment === "	") {
    return 3;
  }
  if (terminalSpacingMarkRegex.test(segment)) {
    return [...segment].length;
  }
  if (zeroWidthRegex.test(segment)) {
    return 0;
  }
  if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
    return 2;
  }
  const base = segment.replace(leadingNonPrintingRegex, "");
  const cp = base.codePointAt(0);
  if (cp === void 0) {
    return 0;
  }
  if (cp >= 127462 && cp <= 127487) {
    return 2;
  }
  let width = eastAsianWidth(cp);
  let followsMark = false;
  const chars = [...base];
  for (const char of chars.slice(1)) {
    if (terminalSpacingMarkRegex.test(char)) {
      width += 1;
      followsMark = false;
    } else if (markCharRegex.test(char)) {
      followsMark = true;
    } else if (!nonPrintingCharRegex.test(char)) {
      const c = char.codePointAt(0);
      if (followsMark || c >= 65280 && c <= 65519) {
        width += eastAsianWidth(c);
      } else if (c === 3635 || c === 3763) {
        width += 1;
      }
      followsMark = false;
    }
  }
  return width;
}
function visibleWidth(str) {
  if (str.length === 0) {
    return 0;
  }
  if (isPrintableAscii(str)) {
    return str.length;
  }
  const cached = widthCache.get(str);
  if (cached !== void 0) {
    return cached;
  }
  let clean = str;
  if (str.includes("	")) {
    clean = clean.replace(/\t/g, "   ");
  }
  if (clean.includes("\x1B")) {
    let stripped = "";
    let i = 0;
    while (i < clean.length) {
      const ansi = extractAnsiCode(clean, i);
      if (ansi) {
        i += ansi.length;
        continue;
      }
      stripped += clean[i];
      i++;
    }
    clean = stripped;
  }
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(clean)) {
    width += graphemeWidth(segment);
  }
  if (widthCache.size >= WIDTH_CACHE_SIZE) {
    const firstKey = widthCache.keys().next().value;
    if (firstKey !== void 0) {
      widthCache.delete(firstKey);
    }
  }
  widthCache.set(str, width);
  return width;
}
function stripTerminalSequences(str) {
  if (!str.includes("\x1B")) return str;
  let result = "";
  let i = 0;
  while (i < str.length) {
    const ansi = extractAnsiCode(str, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    result += str[i];
    i++;
  }
  return result;
}
function getGraphemeCellRange(line, column) {
  let currentCol = 0;
  let i = 0;
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    let textEnd = i;
    while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
    for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
      const width = graphemeWidth(segment);
      if (width > 0 && column >= currentCol && column < currentCol + width) {
        return { start: currentCol, end: currentCol + width };
      }
      currentCol += width;
    }
    i = textEnd;
  }
  return void 0;
}
function getOsc8LinkAtColumn(line, column) {
  let activeUrl;
  let currentCol = 0;
  let i = 0;
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      const hyperlink2 = /^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)$/.exec(ansi.code);
      if (hyperlink2) activeUrl = hyperlink2[1] || void 0;
      i += ansi.length;
      continue;
    }
    let textEnd = i;
    while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
    for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
      const width = segment === "	" ? 3 : graphemeWidth(segment);
      if (column >= currentCol && column < currentCol + width) return activeUrl;
      currentCol += width;
    }
    i = textEnd;
  }
  return void 0;
}
var THAI_LAO_AM_REGEX = /[\u0e33\u0eb3]/;
var THAI_LAO_AM_GLOBAL_REGEX = /[\u0e33\u0eb3]/g;
function normalizeTerminalOutput(str) {
  let normalized = str;
  if (THAI_LAO_AM_REGEX.test(normalized)) {
    normalized = normalized.replace(
      THAI_LAO_AM_GLOBAL_REGEX,
      (char) => char === "\u0E33" ? "\u0E4D\u0E32" : "\u0ECD\u0EB2"
    );
  }
  if (!normalized.includes("	")) return normalized;
  let result = "";
  let i = 0;
  while (i < normalized.length) {
    const ansi = extractAnsiCode(normalized, i);
    if (ansi) {
      result += ansi.code;
      i += ansi.length;
      continue;
    }
    result += normalized[i] === "	" ? "   " : normalized[i];
    i++;
  }
  return result;
}
function extractAnsiCode(str, pos) {
  if (pos >= str.length || str[pos] !== "\x1B") return null;
  const next = str[pos + 1];
  if (next === "[") {
    let j = pos + 2;
    while (j < str.length && !/[mGKHJ]/.test(str[j])) j++;
    if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
    return null;
  }
  if (next === "]") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1B" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }
  if (next === "_") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1B" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }
  return null;
}
function parseOsc8Hyperlink(ansiCode) {
  if (!ansiCode.startsWith("\x1B]8;")) {
    return void 0;
  }
  const terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1B\\";
  const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
  const separatorIndex = body.indexOf(";");
  if (separatorIndex === -1) {
    return void 0;
  }
  const params = body.slice(0, separatorIndex);
  const url = body.slice(separatorIndex + 1);
  if (!url) {
    return null;
  }
  return { params, url, terminator };
}
function formatOsc8Hyperlink(hyperlink2) {
  return `\x1B]8;${hyperlink2.params};${hyperlink2.url}${hyperlink2.terminator}`;
}
function formatOsc8Close(terminator) {
  return `\x1B]8;;${terminator}`;
}
var AnsiCodeTracker = class {
  // Track individual attributes separately so we can reset them specifically
  bold = false;
  dim = false;
  italic = false;
  underline = false;
  blink = false;
  inverse = false;
  hidden = false;
  strikethrough = false;
  fgColor = null;
  // Stores the full code like "31" or "38;5;240"
  bgColor = null;
  // Stores the full code like "41" or "48;5;240"
  activeHyperlink = null;
  process(ansiCode) {
    const hyperlink2 = parseOsc8Hyperlink(ansiCode);
    if (hyperlink2 !== void 0) {
      this.activeHyperlink = hyperlink2;
      return;
    }
    if (!ansiCode.endsWith("m")) {
      return;
    }
    const match = ansiCode.match(/\x1b\[([\d;]*)m/);
    if (!match) return;
    const params = match[1];
    if (params === "" || params === "0") {
      this.reset();
      return;
    }
    const parts = params.split(";");
    let i = 0;
    while (i < parts.length) {
      const code = Number.parseInt(parts[i], 10);
      if (code === 38 || code === 48) {
        if (parts[i + 1] === "5" && parts[i + 2] !== void 0) {
          const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
          if (code === 38) {
            this.fgColor = colorCode;
          } else {
            this.bgColor = colorCode;
          }
          i += 3;
          continue;
        } else if (parts[i + 1] === "2" && parts[i + 4] !== void 0) {
          const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
          if (code === 38) {
            this.fgColor = colorCode;
          } else {
            this.bgColor = colorCode;
          }
          i += 5;
          continue;
        }
      }
      switch (code) {
        case 0:
          this.reset();
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 3:
          this.italic = true;
          break;
        case 4:
          this.underline = true;
          break;
        case 5:
          this.blink = true;
          break;
        case 7:
          this.inverse = true;
          break;
        case 8:
          this.hidden = true;
          break;
        case 9:
          this.strikethrough = true;
          break;
        case 21:
          this.bold = false;
          break;
        // Some terminals
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 23:
          this.italic = false;
          break;
        case 24:
          this.underline = false;
          break;
        case 25:
          this.blink = false;
          break;
        case 27:
          this.inverse = false;
          break;
        case 28:
          this.hidden = false;
          break;
        case 29:
          this.strikethrough = false;
          break;
        case 39:
          this.fgColor = null;
          break;
        // Default fg
        case 49:
          this.bgColor = null;
          break;
        // Default bg
        default:
          if (code >= 30 && code <= 37 || code >= 90 && code <= 97) {
            this.fgColor = String(code);
          } else if (code >= 40 && code <= 47 || code >= 100 && code <= 107) {
            this.bgColor = String(code);
          }
          break;
      }
      i++;
    }
  }
  reset() {
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.blink = false;
    this.inverse = false;
    this.hidden = false;
    this.strikethrough = false;
    this.fgColor = null;
    this.bgColor = null;
  }
  /** Clear all state for reuse. */
  clear() {
    this.reset();
    this.activeHyperlink = null;
  }
  getActiveCodes() {
    const codes = [];
    if (this.bold) codes.push("1");
    if (this.dim) codes.push("2");
    if (this.italic) codes.push("3");
    if (this.underline) codes.push("4");
    if (this.blink) codes.push("5");
    if (this.inverse) codes.push("7");
    if (this.hidden) codes.push("8");
    if (this.strikethrough) codes.push("9");
    if (this.fgColor) codes.push(this.fgColor);
    if (this.bgColor) codes.push(this.bgColor);
    let result = codes.length > 0 ? `\x1B[${codes.join(";")}m` : "";
    if (this.activeHyperlink) {
      result += formatOsc8Hyperlink(this.activeHyperlink);
    }
    return result;
  }
  hasActiveCodes() {
    return this.bold || this.dim || this.italic || this.underline || this.blink || this.inverse || this.hidden || this.strikethrough || this.fgColor !== null || this.bgColor !== null || this.activeHyperlink !== null;
  }
  /**
   * Get reset codes for attributes that need to be turned off at line end.
   * Underline must be closed to prevent bleeding into padding.
   * Active OSC 8 hyperlinks must be closed and re-opened on the next line.
   * Returns empty string if no attributes need closing.
   */
  getLineEndReset() {
    let result = "";
    if (this.underline) {
      result += "\x1B[24m";
    }
    if (this.activeHyperlink) {
      result += formatOsc8Close(this.activeHyperlink.terminator);
    }
    return result;
  }
};
function updateTrackerFromText(text, tracker) {
  let i = 0;
  while (i < text.length) {
    const ansiResult = extractAnsiCode(text, i);
    if (ansiResult) {
      tracker.process(ansiResult.code);
      i += ansiResult.length;
    } else {
      i++;
    }
  }
}
function splitIntoTokensWithAnsi(text) {
  const tokens = [];
  let current = "";
  let pendingAnsi = "";
  let currentKind = null;
  let i = 0;
  const flushCurrent = () => {
    if (!current) {
      return;
    }
    tokens.push(current);
    current = "";
    currentKind = null;
  };
  while (i < text.length) {
    const ansiResult = extractAnsiCode(text, i);
    if (ansiResult) {
      pendingAnsi += ansiResult.code;
      i += ansiResult.length;
      continue;
    }
    let end = i;
    while (end < text.length && !extractAnsiCode(text, end)) {
      end++;
    }
    for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
      const segmentIsSpace = segment === " ";
      if (!segmentIsSpace && cjkBreakRegex.test(segment)) {
        flushCurrent();
        const token = pendingAnsi + segment;
        pendingAnsi = "";
        tokens.push(token);
        continue;
      }
      const segmentKind = segmentIsSpace ? "space" : "word";
      if (current && currentKind !== segmentKind) {
        flushCurrent();
      }
      if (pendingAnsi) {
        current += pendingAnsi;
        pendingAnsi = "";
      }
      currentKind = segmentKind;
      current += segment;
    }
    i = end;
  }
  if (pendingAnsi) {
    if (current) {
      current += pendingAnsi;
    } else if (tokens.length > 0) {
      tokens[tokens.length - 1] += pendingAnsi;
    } else {
      current = pendingAnsi;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
function wrapTextWithAnsi(text, width) {
  if (!text) {
    return [""];
  }
  const inputLines = text.split(/\r\n|\r|\n/);
  const result = [];
  const tracker = new AnsiCodeTracker();
  for (const inputLine of inputLines) {
    const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
    const wrappedLines = wrapSingleLine(prefix + inputLine, width);
    for (const wrappedLine of wrappedLines) {
      result.push(wrappedLine);
    }
    updateTrackerFromText(inputLine, tracker);
  }
  return result.length > 0 ? result : [""];
}
function wrapSingleLine(line, width) {
  if (!line) {
    return [""];
  }
  const visibleLength = visibleWidth(line);
  if (visibleLength <= width) {
    return [line];
  }
  const wrapped = [];
  const tracker = new AnsiCodeTracker();
  const tokens = splitIntoTokensWithAnsi(line);
  let currentLine = "";
  let currentVisibleLength = 0;
  for (const token of tokens) {
    const tokenVisibleLength = visibleWidth(token);
    const isWhitespace = token.trim() === "";
    if (tokenVisibleLength > width && !isWhitespace) {
      if (currentLine) {
        const lineEndReset = tracker.getLineEndReset();
        if (lineEndReset) {
          currentLine += lineEndReset;
        }
        wrapped.push(currentLine);
        currentLine = "";
        currentVisibleLength = 0;
      }
      const broken = breakLongWord(token, width, tracker);
      for (let i = 0; i < broken.length - 1; i++) {
        wrapped.push(broken[i]);
      }
      currentLine = broken[broken.length - 1];
      currentVisibleLength = visibleWidth(currentLine);
      continue;
    }
    const totalNeeded = currentVisibleLength + tokenVisibleLength;
    if (totalNeeded > width && currentVisibleLength > 0) {
      let lineToWrap = currentLine.trimEnd();
      const lineEndReset = tracker.getLineEndReset();
      if (lineEndReset) {
        lineToWrap += lineEndReset;
      }
      wrapped.push(lineToWrap);
      if (isWhitespace) {
        currentLine = tracker.getActiveCodes();
        currentVisibleLength = 0;
      } else {
        currentLine = tracker.getActiveCodes() + token;
        currentVisibleLength = tokenVisibleLength;
      }
    } else {
      currentLine += token;
      currentVisibleLength += tokenVisibleLength;
    }
    updateTrackerFromText(token, tracker);
  }
  if (currentLine) {
    wrapped.push(currentLine);
  }
  return wrapped.length > 0 ? wrapped.map((line2) => line2.trimEnd()) : [""];
}
var PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;
function isWhitespaceChar(char) {
  return /\s/.test(char);
}
function breakLongWord(word, width, tracker) {
  const lines = [];
  let currentLine = tracker.getActiveCodes();
  let currentWidth = 0;
  let i = 0;
  const segments = [];
  while (i < word.length) {
    const ansiResult = extractAnsiCode(word, i);
    if (ansiResult) {
      segments.push({ type: "ansi", value: ansiResult.code });
      i += ansiResult.length;
    } else {
      let end = i;
      while (end < word.length) {
        const nextAnsi = extractAnsiCode(word, end);
        if (nextAnsi) break;
        end++;
      }
      const textPortion = word.slice(i, end);
      for (const seg of graphemeSegmenter.segment(textPortion)) {
        segments.push({ type: "grapheme", value: seg.segment });
      }
      i = end;
    }
  }
  for (const seg of segments) {
    if (seg.type === "ansi") {
      currentLine += seg.value;
      tracker.process(seg.value);
      continue;
    }
    const grapheme = seg.value;
    if (!grapheme) continue;
    const graphemeWidth2 = visibleWidth(grapheme);
    if (currentWidth + graphemeWidth2 > width) {
      const lineEndReset = tracker.getLineEndReset();
      if (lineEndReset) {
        currentLine += lineEndReset;
      }
      lines.push(currentLine);
      currentLine = tracker.getActiveCodes();
      currentWidth = 0;
    }
    currentLine += grapheme;
    currentWidth += graphemeWidth2;
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [""];
}
function applyBackgroundToLine(line, width, bgFn) {
  const visibleLen = visibleWidth(line);
  const paddingNeeded = Math.max(0, width - visibleLen);
  const padding = " ".repeat(paddingNeeded);
  const withPadding = line + padding;
  return bgFn(withPadding);
}
function truncateToWidth(text, maxWidth, ellipsis = "...", pad = false) {
  if (maxWidth <= 0) {
    return "";
  }
  if (text.length === 0) {
    return pad ? " ".repeat(maxWidth) : "";
  }
  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    const textWidth = visibleWidth(text);
    if (textWidth <= maxWidth) {
      return pad ? text + " ".repeat(maxWidth - textWidth) : text;
    }
    const clippedEllipsis = truncateFragmentToWidth(ellipsis, maxWidth);
    if (clippedEllipsis.width === 0) {
      return pad ? " ".repeat(maxWidth) : "";
    }
    return finalizeTruncatedResult("", 0, clippedEllipsis.text, clippedEllipsis.width, maxWidth, pad);
  }
  if (isPrintableAscii(text)) {
    if (text.length <= maxWidth) {
      return pad ? text + " ".repeat(maxWidth - text.length) : text;
    }
    const targetWidth2 = maxWidth - ellipsisWidth;
    return finalizeTruncatedResult(text.slice(0, targetWidth2), targetWidth2, ellipsis, ellipsisWidth, maxWidth, pad);
  }
  const targetWidth = maxWidth - ellipsisWidth;
  let result = "";
  let pendingAnsi = "";
  let visibleSoFar = 0;
  let keptWidth = 0;
  let keepContiguousPrefix = true;
  let overflowed = false;
  let exhaustedInput = false;
  const hasAnsi = text.includes("\x1B");
  const hasTabs = text.includes("	");
  if (!hasAnsi && !hasTabs) {
    for (const { segment } of graphemeSegmenter.segment(text)) {
      const width = graphemeWidth(segment);
      if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
        result += segment;
        keptWidth += width;
      } else {
        keepContiguousPrefix = false;
      }
      visibleSoFar += width;
      if (visibleSoFar > maxWidth) {
        overflowed = true;
        break;
      }
    }
    exhaustedInput = !overflowed;
  } else {
    let i = 0;
    while (i < text.length) {
      const ansi = extractAnsiCode(text, i);
      if (ansi) {
        pendingAnsi += ansi.code;
        i += ansi.length;
        continue;
      }
      if (text[i] === "	") {
        if (keepContiguousPrefix && keptWidth + 3 <= targetWidth) {
          if (pendingAnsi) {
            result += pendingAnsi;
            pendingAnsi = "";
          }
          result += "	";
          keptWidth += 3;
        } else {
          keepContiguousPrefix = false;
          pendingAnsi = "";
        }
        visibleSoFar += 3;
        if (visibleSoFar > maxWidth) {
          overflowed = true;
          break;
        }
        i++;
        continue;
      }
      let end = i;
      while (end < text.length && text[end] !== "	") {
        const nextAnsi = extractAnsiCode(text, end);
        if (nextAnsi) {
          break;
        }
        end++;
      }
      for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
        const width = graphemeWidth(segment);
        if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
          if (pendingAnsi) {
            result += pendingAnsi;
            pendingAnsi = "";
          }
          result += segment;
          keptWidth += width;
        } else {
          keepContiguousPrefix = false;
          pendingAnsi = "";
        }
        visibleSoFar += width;
        if (visibleSoFar > maxWidth) {
          overflowed = true;
          break;
        }
      }
      if (overflowed) {
        break;
      }
      i = end;
    }
    exhaustedInput = i >= text.length;
  }
  if (!overflowed && exhaustedInput) {
    return pad ? text + " ".repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
  }
  return finalizeTruncatedResult(result, keptWidth, ellipsis, ellipsisWidth, maxWidth, pad);
}
function sliceByColumn(line, startCol, length, strict = false) {
  return sliceWithWidth(line, startCol, length, strict).text;
}
function sliceWithWidth(line, startCol, length, strict = false) {
  if (length <= 0) return { text: "", width: 0 };
  const endCol = startCol + length;
  let result = "", resultWidth = 0, currentCol = 0, i = 0, pendingAnsi = "";
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
      else if (currentCol < startCol) pendingAnsi += ansi.code;
      i += ansi.length;
      continue;
    }
    let textEnd = i;
    while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
    for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
      const w = graphemeWidth(segment);
      const inRange = currentCol >= startCol && currentCol < endCol;
      const fits = !strict || currentCol + w <= endCol;
      if (inRange && fits) {
        if (pendingAnsi) {
          result += pendingAnsi;
          pendingAnsi = "";
        }
        result += segment;
        resultWidth += w;
      }
      currentCol += w;
      if (currentCol >= endCol) break;
    }
    i = textEnd;
    if (currentCol >= endCol) break;
  }
  return { text: result, width: resultWidth };
}
var pooledStyleTracker = new AnsiCodeTracker();
function extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter = false) {
  let before = "", beforeWidth = 0, after = "", afterWidth = 0;
  let currentCol = 0, i = 0;
  let pendingAnsiBefore = "";
  let afterStarted = false;
  const afterEnd = afterStart + afterLen;
  pooledStyleTracker.clear();
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      pooledStyleTracker.process(ansi.code);
      if (currentCol < beforeEnd) {
        pendingAnsiBefore += ansi.code;
      } else if (currentCol >= afterStart && currentCol < afterEnd && afterStarted) {
        after += ansi.code;
      }
      i += ansi.length;
      continue;
    }
    let textEnd = i;
    while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
    for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
      const w = graphemeWidth(segment);
      if (currentCol < beforeEnd && currentCol + w <= beforeEnd) {
        if (pendingAnsiBefore) {
          before += pendingAnsiBefore;
          pendingAnsiBefore = "";
        }
        before += segment;
        beforeWidth += w;
      } else if (currentCol >= afterStart && currentCol < afterEnd) {
        const fits = !strictAfter || currentCol + w <= afterEnd;
        if (fits) {
          if (!afterStarted) {
            after += pooledStyleTracker.getActiveCodes();
            afterStarted = true;
          }
          after += segment;
          afterWidth += w;
        }
      }
      currentCol += w;
      if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
    }
    i = textEnd;
    if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
  }
  return { before, beforeWidth, after, afterWidth };
}

// tui/src/components/box.ts
var Box = class {
  children = [];
  paddingX;
  paddingY;
  bgFn;
  // Cache for rendered output
  cache;
  constructor(paddingX = 1, paddingY = 1, bgFn) {
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.bgFn = bgFn;
  }
  addChild(component) {
    this.children.push(component);
    this.invalidateCache();
  }
  removeChild(component) {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
      this.invalidateCache();
    }
  }
  clear() {
    this.children = [];
    this.invalidateCache();
  }
  setBgFn(bgFn) {
    this.bgFn = bgFn;
  }
  invalidateCache() {
    this.cache = void 0;
  }
  matchCache(width, childLines, bgSample) {
    const cache = this.cache;
    return !!cache && cache.width === width && cache.bgSample === bgSample && cache.childLines.length === childLines.length && cache.childLines.every((line, i) => line === childLines[i]);
  }
  invalidate() {
    this.invalidateCache();
    for (const child of this.children) {
      child.invalidate?.();
    }
  }
  render(width) {
    if (this.children.length === 0) {
      return [];
    }
    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const leftPad = " ".repeat(this.paddingX);
    const childLines = [];
    for (const child of this.children) {
      const lines = child.render(contentWidth);
      for (const line of lines) {
        childLines.push(leftPad + line);
      }
    }
    if (childLines.length === 0) {
      return [];
    }
    const bgSample = this.bgFn ? this.bgFn("test") : void 0;
    if (this.matchCache(width, childLines, bgSample)) {
      return this.cache.lines;
    }
    const result = [];
    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg("", width));
    }
    for (const line of childLines) {
      result.push(this.applyBg(line, width));
    }
    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg("", width));
    }
    this.cache = { childLines, width, bgSample, lines: result };
    return result;
  }
  applyBg(line, width) {
    const visLen = visibleWidth(line);
    const padNeeded = Math.max(0, width - visLen);
    const padded = line + " ".repeat(padNeeded);
    if (this.bgFn) {
      return applyBackgroundToLine(padded, width, this.bgFn);
    }
    return padded;
  }
};

// tui/src/keys.ts
var _kittyProtocolActive = false;
function setKittyProtocolActive(active) {
  _kittyProtocolActive = active;
}
function isKittyProtocolActive() {
  return _kittyProtocolActive;
}
var Key = {
  // Special keys
  escape: "escape",
  esc: "esc",
  enter: "enter",
  return: "return",
  tab: "tab",
  space: "space",
  backspace: "backspace",
  delete: "delete",
  insert: "insert",
  clear: "clear",
  home: "home",
  end: "end",
  pageUp: "pageUp",
  pageDown: "pageDown",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  f1: "f1",
  f2: "f2",
  f3: "f3",
  f4: "f4",
  f5: "f5",
  f6: "f6",
  f7: "f7",
  f8: "f8",
  f9: "f9",
  f10: "f10",
  f11: "f11",
  f12: "f12",
  // Symbol keys
  backtick: "`",
  hyphen: "-",
  equals: "=",
  leftbracket: "[",
  rightbracket: "]",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  comma: ",",
  period: ".",
  slash: "/",
  exclamation: "!",
  at: "@",
  hash: "#",
  dollar: "$",
  percent: "%",
  caret: "^",
  ampersand: "&",
  asterisk: "*",
  leftparen: "(",
  rightparen: ")",
  underscore: "_",
  plus: "+",
  pipe: "|",
  tilde: "~",
  leftbrace: "{",
  rightbrace: "}",
  colon: ":",
  lessthan: "<",
  greaterthan: ">",
  question: "?",
  // Single modifiers
  ctrl: (key) => `ctrl+${key}`,
  shift: (key) => `shift+${key}`,
  alt: (key) => `alt+${key}`,
  super: (key) => `super+${key}`,
  // Combined modifiers
  ctrlShift: (key) => `ctrl+shift+${key}`,
  shiftCtrl: (key) => `shift+ctrl+${key}`,
  ctrlAlt: (key) => `ctrl+alt+${key}`,
  altCtrl: (key) => `alt+ctrl+${key}`,
  shiftAlt: (key) => `shift+alt+${key}`,
  altShift: (key) => `alt+shift+${key}`,
  ctrlSuper: (key) => `ctrl+super+${key}`,
  superCtrl: (key) => `super+ctrl+${key}`,
  shiftSuper: (key) => `shift+super+${key}`,
  superShift: (key) => `super+shift+${key}`,
  altSuper: (key) => `alt+super+${key}`,
  superAlt: (key) => `super+alt+${key}`,
  // Triple modifiers
  ctrlShiftAlt: (key) => `ctrl+shift+alt+${key}`,
  ctrlShiftSuper: (key) => `ctrl+shift+super+${key}`
};
var SYMBOL_KEYS = /* @__PURE__ */ new Set([
  "`",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "|",
  "~",
  "{",
  "}",
  ":",
  "<",
  ">",
  "?"
]);
var MODIFIERS = {
  shift: 1,
  alt: 2,
  ctrl: 4,
  super: 8
};
var LOCK_MASK = 64 + 128;
var CODEPOINTS = {
  escape: 27,
  tab: 9,
  enter: 13,
  space: 32,
  backspace: 127,
  kpEnter: 57414
  // Numpad Enter (Kitty protocol)
};
var ARROW_CODEPOINTS = {
  up: -1,
  down: -2,
  right: -3,
  left: -4
};
var FUNCTIONAL_CODEPOINTS = {
  delete: -10,
  insert: -11,
  pageUp: -12,
  pageDown: -13,
  home: -14,
  end: -15
};
var KITTY_FUNCTIONAL_KEY_EQUIVALENTS = /* @__PURE__ */ new Map([
  [57399, 48],
  // KP_0 -> 0
  [57400, 49],
  // KP_1 -> 1
  [57401, 50],
  // KP_2 -> 2
  [57402, 51],
  // KP_3 -> 3
  [57403, 52],
  // KP_4 -> 4
  [57404, 53],
  // KP_5 -> 5
  [57405, 54],
  // KP_6 -> 6
  [57406, 55],
  // KP_7 -> 7
  [57407, 56],
  // KP_8 -> 8
  [57408, 57],
  // KP_9 -> 9
  [57409, 46],
  // KP_DECIMAL -> .
  [57410, 47],
  // KP_DIVIDE -> /
  [57411, 42],
  // KP_MULTIPLY -> *
  [57412, 45],
  // KP_SUBTRACT -> -
  [57413, 43],
  // KP_ADD -> +
  [57415, 61],
  // KP_EQUAL -> =
  [57416, 44],
  // KP_SEPARATOR -> ,
  [57417, ARROW_CODEPOINTS.left],
  [57418, ARROW_CODEPOINTS.right],
  [57419, ARROW_CODEPOINTS.up],
  [57420, ARROW_CODEPOINTS.down],
  [57421, FUNCTIONAL_CODEPOINTS.pageUp],
  [57422, FUNCTIONAL_CODEPOINTS.pageDown],
  [57423, FUNCTIONAL_CODEPOINTS.home],
  [57424, FUNCTIONAL_CODEPOINTS.end],
  [57425, FUNCTIONAL_CODEPOINTS.insert],
  [57426, FUNCTIONAL_CODEPOINTS.delete]
]);
function normalizeKittyFunctionalCodepoint(codepoint) {
  return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(codepoint) ?? codepoint;
}
function normalizeShiftedLetterIdentityCodepoint(codepoint, modifier) {
  const effectiveModifier = modifier & ~LOCK_MASK;
  if ((effectiveModifier & MODIFIERS.shift) !== 0 && codepoint >= 65 && codepoint <= 90) {
    return codepoint + 32;
  }
  return codepoint;
}
var LEGACY_KEY_SEQUENCES = {
  up: ["\x1B[A", "\x1BOA"],
  down: ["\x1B[B", "\x1BOB"],
  right: ["\x1B[C", "\x1BOC"],
  left: ["\x1B[D", "\x1BOD"],
  home: ["\x1B[H", "\x1BOH", "\x1B[1~", "\x1B[7~"],
  end: ["\x1B[F", "\x1BOF", "\x1B[4~", "\x1B[8~"],
  insert: ["\x1B[2~"],
  delete: ["\x1B[3~"],
  pageUp: ["\x1B[5~", "\x1B[[5~"],
  pageDown: ["\x1B[6~", "\x1B[[6~"],
  clear: ["\x1B[E", "\x1BOE"],
  f1: ["\x1BOP", "\x1B[11~", "\x1B[[A"],
  f2: ["\x1BOQ", "\x1B[12~", "\x1B[[B"],
  f3: ["\x1BOR", "\x1B[13~", "\x1B[[C"],
  f4: ["\x1BOS", "\x1B[14~", "\x1B[[D"],
  f5: ["\x1B[15~", "\x1B[[E"],
  f6: ["\x1B[17~"],
  f7: ["\x1B[18~"],
  f8: ["\x1B[19~"],
  f9: ["\x1B[20~"],
  f10: ["\x1B[21~"],
  f11: ["\x1B[23~"],
  f12: ["\x1B[24~"]
};
var LEGACY_SHIFT_SEQUENCES = {
  up: ["\x1B[a"],
  down: ["\x1B[b"],
  right: ["\x1B[c"],
  left: ["\x1B[d"],
  clear: ["\x1B[e"],
  insert: ["\x1B[2$"],
  delete: ["\x1B[3$"],
  pageUp: ["\x1B[5$"],
  pageDown: ["\x1B[6$"],
  home: ["\x1B[7$"],
  end: ["\x1B[8$"]
};
var LEGACY_CTRL_SEQUENCES = {
  up: ["\x1BOa"],
  down: ["\x1BOb"],
  right: ["\x1BOc"],
  left: ["\x1BOd"],
  clear: ["\x1BOe"],
  insert: ["\x1B[2^"],
  delete: ["\x1B[3^"],
  pageUp: ["\x1B[5^"],
  pageDown: ["\x1B[6^"],
  home: ["\x1B[7^"],
  end: ["\x1B[8^"]
};
var LEGACY_SEQUENCE_KEY_IDS = {
  "\x1BOA": "up",
  "\x1BOB": "down",
  "\x1BOC": "right",
  "\x1BOD": "left",
  "\x1BOH": "home",
  "\x1BOF": "end",
  "\x1B[E": "clear",
  "\x1BOE": "clear",
  "\x1BOe": "ctrl+clear",
  "\x1B[e": "shift+clear",
  "\x1B[2~": "insert",
  "\x1B[2$": "shift+insert",
  "\x1B[2^": "ctrl+insert",
  "\x1B[3$": "shift+delete",
  "\x1B[3^": "ctrl+delete",
  "\x1B[[5~": "pageUp",
  "\x1B[[6~": "pageDown",
  "\x1B[a": "shift+up",
  "\x1B[b": "shift+down",
  "\x1B[c": "shift+right",
  "\x1B[d": "shift+left",
  "\x1BOa": "ctrl+up",
  "\x1BOb": "ctrl+down",
  "\x1BOc": "ctrl+right",
  "\x1BOd": "ctrl+left",
  "\x1B[5$": "shift+pageUp",
  "\x1B[6$": "shift+pageDown",
  "\x1B[7$": "shift+home",
  "\x1B[8$": "shift+end",
  "\x1B[5^": "ctrl+pageUp",
  "\x1B[6^": "ctrl+pageDown",
  "\x1B[7^": "ctrl+home",
  "\x1B[8^": "ctrl+end",
  "\x1BOP": "f1",
  "\x1BOQ": "f2",
  "\x1BOR": "f3",
  "\x1BOS": "f4",
  "\x1B[11~": "f1",
  "\x1B[12~": "f2",
  "\x1B[13~": "f3",
  "\x1B[14~": "f4",
  "\x1B[[A": "f1",
  "\x1B[[B": "f2",
  "\x1B[[C": "f3",
  "\x1B[[D": "f4",
  "\x1B[[E": "f5",
  "\x1B[15~": "f5",
  "\x1B[17~": "f6",
  "\x1B[18~": "f7",
  "\x1B[19~": "f8",
  "\x1B[20~": "f9",
  "\x1B[21~": "f10",
  "\x1B[23~": "f11",
  "\x1B[24~": "f12",
  "\x1Bb": "alt+left",
  "\x1Bf": "alt+right",
  "\x1Bp": "alt+up",
  "\x1Bn": "alt+down"
};
var matchesLegacySequence = (data, sequences) => sequences.includes(data);
var matchesLegacyModifierSequence = (data, key, modifier) => {
  if (modifier === MODIFIERS.shift) {
    return matchesLegacySequence(data, LEGACY_SHIFT_SEQUENCES[key]);
  }
  if (modifier === MODIFIERS.ctrl) {
    return matchesLegacySequence(data, LEGACY_CTRL_SEQUENCES[key]);
  }
  return false;
};
var _lastEventType = "press";
function isKeyRelease(data) {
  if (data.includes("\x1B[200~")) {
    return false;
  }
  if (data.includes(":3u") || data.includes(":3~") || data.includes(":3A") || data.includes(":3B") || data.includes(":3C") || data.includes(":3D") || data.includes(":3H") || data.includes(":3F")) {
    return true;
  }
  return false;
}
function isKeyRepeat(data) {
  if (data.includes("\x1B[200~")) {
    return false;
  }
  if (data.includes(":2u") || data.includes(":2~") || data.includes(":2A") || data.includes(":2B") || data.includes(":2C") || data.includes(":2D") || data.includes(":2H") || data.includes(":2F")) {
    return true;
  }
  return false;
}
function parseEventType(eventTypeStr) {
  if (!eventTypeStr) return "press";
  const eventType = parseInt(eventTypeStr, 10);
  if (eventType === 2) return "repeat";
  if (eventType === 3) return "release";
  return "press";
}
function parseKittySequence(data) {
  const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
  if (csiUMatch) {
    const codepoint = parseInt(csiUMatch[1], 10);
    const shiftedKey = csiUMatch[2] && csiUMatch[2].length > 0 ? parseInt(csiUMatch[2], 10) : void 0;
    const baseLayoutKey = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : void 0;
    const modValue = csiUMatch[4] ? parseInt(csiUMatch[4], 10) : 1;
    const eventType = parseEventType(csiUMatch[5]);
    _lastEventType = eventType;
    return { codepoint, shiftedKey, baseLayoutKey, modifier: modValue - 1, eventType };
  }
  const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
  if (arrowMatch) {
    const modValue = parseInt(arrowMatch[1], 10);
    const eventType = parseEventType(arrowMatch[2]);
    const arrowCodes = { A: -1, B: -2, C: -3, D: -4 };
    _lastEventType = eventType;
    return { codepoint: arrowCodes[arrowMatch[3]], modifier: modValue - 1, eventType };
  }
  const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
  if (funcMatch) {
    const keyNum = parseInt(funcMatch[1], 10);
    const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
    const eventType = parseEventType(funcMatch[3]);
    const funcCodes = {
      2: FUNCTIONAL_CODEPOINTS.insert,
      3: FUNCTIONAL_CODEPOINTS.delete,
      5: FUNCTIONAL_CODEPOINTS.pageUp,
      6: FUNCTIONAL_CODEPOINTS.pageDown,
      7: FUNCTIONAL_CODEPOINTS.home,
      8: FUNCTIONAL_CODEPOINTS.end
    };
    const codepoint = funcCodes[keyNum];
    if (codepoint !== void 0) {
      _lastEventType = eventType;
      return { codepoint, modifier: modValue - 1, eventType };
    }
  }
  const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
  if (homeEndMatch) {
    const modValue = parseInt(homeEndMatch[1], 10);
    const eventType = parseEventType(homeEndMatch[2]);
    const codepoint = homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
    _lastEventType = eventType;
    return { codepoint, modifier: modValue - 1, eventType };
  }
  return null;
}
function matchesKittySequence(data, expectedCodepoint, expectedModifier) {
  const parsed = parseKittySequence(data);
  if (!parsed) return false;
  const actualMod = parsed.modifier & ~LOCK_MASK;
  const expectedMod = expectedModifier & ~LOCK_MASK;
  if (actualMod !== expectedMod) return false;
  const normalizedCodepoint = normalizeShiftedLetterIdentityCodepoint(
    normalizeKittyFunctionalCodepoint(parsed.codepoint),
    parsed.modifier
  );
  const normalizedExpectedCodepoint = normalizeShiftedLetterIdentityCodepoint(
    normalizeKittyFunctionalCodepoint(expectedCodepoint),
    expectedModifier
  );
  if (normalizedCodepoint === normalizedExpectedCodepoint) return true;
  if (parsed.baseLayoutKey !== void 0 && parsed.baseLayoutKey === expectedCodepoint) {
    const cp = normalizedCodepoint;
    const isLatinLetter = cp >= 97 && cp <= 122;
    const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(cp));
    if (!isLatinLetter && !isKnownSymbol) return true;
  }
  return false;
}
function parseModifyOtherKeysSequence(data) {
  const match = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
  if (!match) return null;
  const modValue = parseInt(match[1], 10);
  const codepoint = parseInt(match[2], 10);
  return { codepoint, modifier: modValue - 1 };
}
function matchesModifyOtherKeys(data, expectedKeycode, expectedModifier) {
  const parsed = parseModifyOtherKeysSequence(data);
  if (!parsed) return false;
  return parsed.codepoint === expectedKeycode && parsed.modifier === expectedModifier;
}
function isWindowsTerminalSession() {
  return Boolean(process.env.WT_SESSION) && !process.env.SSH_CONNECTION && !process.env.SSH_CLIENT && !process.env.SSH_TTY;
}
function matchesRawBackspace(data, expectedModifier) {
  if (data === "\x7F") return expectedModifier === 0;
  if (data !== "\b") return false;
  return isWindowsTerminalSession() ? expectedModifier === MODIFIERS.ctrl : expectedModifier === 0;
}
function rawCtrlChar(key) {
  const char = key.toLowerCase();
  const code = char.charCodeAt(0);
  if (code >= 97 && code <= 122 || char === "[" || char === "\\" || char === "]" || char === "_") {
    return String.fromCharCode(code & 31);
  }
  if (char === "-") {
    return String.fromCharCode(31);
  }
  return null;
}
function isDigitKey(key) {
  return key >= "0" && key <= "9";
}
function matchesPrintableModifyOtherKeys(data, expectedKeycode, expectedModifier) {
  if (expectedModifier === 0) return false;
  const parsed = parseModifyOtherKeysSequence(data);
  if (!parsed || parsed.modifier !== expectedModifier) return false;
  return normalizeShiftedLetterIdentityCodepoint(parsed.codepoint, parsed.modifier) === normalizeShiftedLetterIdentityCodepoint(expectedKeycode, expectedModifier);
}
function formatKeyNameWithModifiers(keyName, modifier) {
  const mods = [];
  const effectiveMod = modifier & ~LOCK_MASK;
  const supportedModifierMask = MODIFIERS.shift | MODIFIERS.ctrl | MODIFIERS.alt | MODIFIERS.super;
  if ((effectiveMod & ~supportedModifierMask) !== 0) return void 0;
  if (effectiveMod & MODIFIERS.shift) mods.push("shift");
  if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
  if (effectiveMod & MODIFIERS.alt) mods.push("alt");
  if (effectiveMod & MODIFIERS.super) mods.push("super");
  return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
}
function parseKeyId(keyId) {
  const parts = keyId.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  if (!key) return null;
  return {
    key,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    super: parts.includes("super")
  };
}
function matchesKey(data, keyId) {
  const parsed = parseKeyId(keyId);
  if (!parsed) return false;
  const { key, ctrl, shift, alt, super: superModifier } = parsed;
  let modifier = 0;
  if (shift) modifier |= MODIFIERS.shift;
  if (alt) modifier |= MODIFIERS.alt;
  if (ctrl) modifier |= MODIFIERS.ctrl;
  if (superModifier) modifier |= MODIFIERS.super;
  switch (key) {
    case "escape":
    case "esc":
      if (modifier !== 0) return false;
      return data === "\x1B" || matchesKittySequence(data, CODEPOINTS.escape, 0) || matchesModifyOtherKeys(data, CODEPOINTS.escape, 0);
    case "space":
      if (!_kittyProtocolActive) {
        if (modifier === MODIFIERS.ctrl && data === "\0") {
          return true;
        }
        if (modifier === MODIFIERS.alt && data === "\x1B ") {
          return true;
        }
      }
      if (modifier === 0) {
        return data === " " || matchesKittySequence(data, CODEPOINTS.space, 0) || matchesModifyOtherKeys(data, CODEPOINTS.space, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.space, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.space, modifier);
    case "tab":
      if (modifier === MODIFIERS.shift) {
        return data === "\x1B[Z" || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift) || matchesModifyOtherKeys(data, CODEPOINTS.tab, MODIFIERS.shift);
      }
      if (modifier === 0) {
        return data === "	" || matchesKittySequence(data, CODEPOINTS.tab, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.tab, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.tab, modifier);
    case "enter":
    case "return":
      if (modifier === MODIFIERS.shift) {
        if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) || matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)) {
          return true;
        }
        if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.shift)) {
          return true;
        }
        if (_kittyProtocolActive) {
          return data === "\x1B\r" || data === "\n";
        }
        return false;
      }
      if (modifier === MODIFIERS.alt) {
        if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) || matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)) {
          return true;
        }
        if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.alt)) {
          return true;
        }
        if (!_kittyProtocolActive) {
          return data === "\x1B\r";
        }
        return false;
      }
      if (modifier === 0) {
        return data === "\r" || !_kittyProtocolActive && data === "\n" || data === "\x1BOM" || // SS3 M (numpad enter in some terminals)
        matchesKittySequence(data, CODEPOINTS.enter, 0) || matchesKittySequence(data, CODEPOINTS.kpEnter, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.enter, modifier) || matchesKittySequence(data, CODEPOINTS.kpEnter, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.enter, modifier);
    case "backspace":
      if (modifier === MODIFIERS.alt) {
        if (data === "\x1B\x7F" || data === "\x1B\b") {
          return true;
        }
        return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.alt);
      }
      if (modifier === MODIFIERS.ctrl) {
        if (matchesRawBackspace(data, MODIFIERS.ctrl)) return true;
        return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.ctrl) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.ctrl);
      }
      if (modifier === 0) {
        return matchesRawBackspace(data, 0) || matchesKittySequence(data, CODEPOINTS.backspace, 0) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.backspace, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, modifier);
    case "insert":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.insert) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, 0);
      }
      if (matchesLegacyModifierSequence(data, "insert", modifier)) {
        return true;
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, modifier);
    case "delete":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.delete) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
      }
      if (matchesLegacyModifierSequence(data, "delete", modifier)) {
        return true;
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, modifier);
    case "clear":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.clear);
      }
      return matchesLegacyModifierSequence(data, "clear", modifier);
    case "home":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.home) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0);
      }
      if (matchesLegacyModifierSequence(data, "home", modifier)) {
        return true;
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, modifier);
    case "end":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.end) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0);
      }
      if (matchesLegacyModifierSequence(data, "end", modifier)) {
        return true;
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, modifier);
    case "pageup":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageUp) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, 0);
      }
      if (matchesLegacyModifierSequence(data, "pageUp", modifier)) {
        return true;
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, modifier);
    case "pagedown":
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageDown) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, 0);
      }
      if (matchesLegacyModifierSequence(data, "pageDown", modifier)) {
        return true;
      }
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, modifier);
    case "up":
      if (modifier === MODIFIERS.alt) {
        return data === "\x1Bp" || matchesKittySequence(data, ARROW_CODEPOINTS.up, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.up) || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
      }
      if (matchesLegacyModifierSequence(data, "up", modifier)) {
        return true;
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.up, modifier);
    case "down":
      if (modifier === MODIFIERS.alt) {
        return data === "\x1Bn" || matchesKittySequence(data, ARROW_CODEPOINTS.down, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.down) || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
      }
      if (matchesLegacyModifierSequence(data, "down", modifier)) {
        return true;
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.down, modifier);
    case "left":
      if (modifier === MODIFIERS.alt) {
        return data === "\x1B[1;3D" || !_kittyProtocolActive && data === "\x1BB" || data === "\x1Bb" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt);
      }
      if (modifier === MODIFIERS.ctrl) {
        return data === "\x1B[1;5D" || matchesLegacyModifierSequence(data, "left", MODIFIERS.ctrl) || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.ctrl);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.left) || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
      }
      if (matchesLegacyModifierSequence(data, "left", modifier)) {
        return true;
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.left, modifier);
    case "right":
      if (modifier === MODIFIERS.alt) {
        return data === "\x1B[1;3C" || !_kittyProtocolActive && data === "\x1BF" || data === "\x1Bf" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt);
      }
      if (modifier === MODIFIERS.ctrl) {
        return data === "\x1B[1;5C" || matchesLegacyModifierSequence(data, "right", MODIFIERS.ctrl) || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.ctrl);
      }
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.right) || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
      }
      if (matchesLegacyModifierSequence(data, "right", modifier)) {
        return true;
      }
      return matchesKittySequence(data, ARROW_CODEPOINTS.right, modifier);
    case "f1":
    case "f2":
    case "f3":
    case "f4":
    case "f5":
    case "f6":
    case "f7":
    case "f8":
    case "f9":
    case "f10":
    case "f11":
    case "f12": {
      if (modifier !== 0) {
        return false;
      }
      const functionKey = key;
      return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[functionKey]);
    }
  }
  if (key.length === 1 && (key >= "a" && key <= "z" || isDigitKey(key) || SYMBOL_KEYS.has(key))) {
    const codepoint = key.charCodeAt(0);
    const rawCtrl = rawCtrlChar(key);
    const isLetter = key >= "a" && key <= "z";
    const isDigit = isDigitKey(key);
    if (modifier === MODIFIERS.ctrl + MODIFIERS.alt && !_kittyProtocolActive && rawCtrl) {
      if (data === `\x1B${rawCtrl}`) return true;
    }
    if (modifier === MODIFIERS.alt && !_kittyProtocolActive && (isLetter || isDigit || SYMBOL_KEYS.has(key))) {
      if (data === `\x1B${key}`) return true;
    }
    if (modifier === MODIFIERS.ctrl) {
      if (rawCtrl && data === rawCtrl) return true;
      return matchesKittySequence(data, codepoint, MODIFIERS.ctrl) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.ctrl);
    }
    if (modifier === MODIFIERS.shift + MODIFIERS.ctrl) {
      return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl);
    }
    if (modifier === MODIFIERS.shift) {
      if (isLetter && data === key.toUpperCase()) return true;
      return matchesKittySequence(data, codepoint, MODIFIERS.shift) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift);
    }
    if (modifier !== 0) {
      return matchesKittySequence(data, codepoint, modifier) || matchesPrintableModifyOtherKeys(data, codepoint, modifier);
    }
    return data === key || matchesKittySequence(data, codepoint, 0);
  }
  return false;
}
function formatParsedKey(codepoint, modifier, baseLayoutKey) {
  const normalizedCodepoint = normalizeKittyFunctionalCodepoint(codepoint);
  const identityCodepoint = normalizeShiftedLetterIdentityCodepoint(normalizedCodepoint, modifier);
  const isLatinLetter = identityCodepoint >= 97 && identityCodepoint <= 122;
  const isDigit = identityCodepoint >= 48 && identityCodepoint <= 57;
  const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(identityCodepoint));
  const effectiveCodepoint = isLatinLetter || isDigit || isKnownSymbol ? identityCodepoint : baseLayoutKey ?? identityCodepoint;
  let keyName;
  if (effectiveCodepoint === CODEPOINTS.escape) keyName = "escape";
  else if (effectiveCodepoint === CODEPOINTS.tab) keyName = "tab";
  else if (effectiveCodepoint === CODEPOINTS.enter || effectiveCodepoint === CODEPOINTS.kpEnter) keyName = "enter";
  else if (effectiveCodepoint === CODEPOINTS.space) keyName = "space";
  else if (effectiveCodepoint === CODEPOINTS.backspace) keyName = "backspace";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.delete) keyName = "delete";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.insert) keyName = "insert";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.home) keyName = "home";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.end) keyName = "end";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageUp) keyName = "pageUp";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageDown) keyName = "pageDown";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.up) keyName = "up";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.down) keyName = "down";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.left) keyName = "left";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.right) keyName = "right";
  else if (effectiveCodepoint >= 48 && effectiveCodepoint <= 57) keyName = String.fromCharCode(effectiveCodepoint);
  else if (effectiveCodepoint >= 97 && effectiveCodepoint <= 122) keyName = String.fromCharCode(effectiveCodepoint);
  else if (SYMBOL_KEYS.has(String.fromCharCode(effectiveCodepoint))) keyName = String.fromCharCode(effectiveCodepoint);
  if (!keyName) return void 0;
  return formatKeyNameWithModifiers(keyName, modifier);
}
function parseKey(data) {
  const kitty = parseKittySequence(data);
  if (kitty) {
    return formatParsedKey(kitty.codepoint, kitty.modifier, kitty.baseLayoutKey);
  }
  const modifyOtherKeys = parseModifyOtherKeysSequence(data);
  if (modifyOtherKeys) {
    return formatParsedKey(modifyOtherKeys.codepoint, modifyOtherKeys.modifier);
  }
  if (_kittyProtocolActive) {
    if (data === "\x1B\r" || data === "\n") return "shift+enter";
  }
  const legacySequenceKeyId = LEGACY_SEQUENCE_KEY_IDS[data];
  if (legacySequenceKeyId) return legacySequenceKeyId;
  if (data === "\x1B") return "escape";
  if (data === "") return "ctrl+\\";
  if (data === "") return "ctrl+]";
  if (data === "") return "ctrl+-";
  if (data === "\x1B\x1B") return "ctrl+alt+[";
  if (data === "\x1B") return "ctrl+alt+\\";
  if (data === "\x1B") return "ctrl+alt+]";
  if (data === "\x1B") return "ctrl+alt+-";
  if (data === "	") return "tab";
  if (data === "\r" || !_kittyProtocolActive && data === "\n" || data === "\x1BOM") return "enter";
  if (data === "\0") return "ctrl+space";
  if (data === " ") return "space";
  if (data === "\x7F") return "backspace";
  if (data === "\b") return isWindowsTerminalSession() ? "ctrl+backspace" : "backspace";
  if (data === "\x1B[Z") return "shift+tab";
  if (!_kittyProtocolActive && data === "\x1B\r") return "alt+enter";
  if (!_kittyProtocolActive && data === "\x1B ") return "alt+space";
  if (data === "\x1B\x7F" || data === "\x1B\b") return "alt+backspace";
  if (!_kittyProtocolActive && data === "\x1BB") return "alt+left";
  if (!_kittyProtocolActive && data === "\x1BF") return "alt+right";
  if (!_kittyProtocolActive && data.length === 2 && data[0] === "\x1B") {
    const code = data.charCodeAt(1);
    if (code >= 1 && code <= 26) {
      return `ctrl+alt+${String.fromCharCode(code + 96)}`;
    }
    const key = String.fromCharCode(code);
    if (code >= 97 && code <= 122 || code >= 48 && code <= 57 || SYMBOL_KEYS.has(key)) {
      return `alt+${key}`;
    }
  }
  if (data === "\x1B[A") return "up";
  if (data === "\x1B[B") return "down";
  if (data === "\x1B[C") return "right";
  if (data === "\x1B[D") return "left";
  if (data === "\x1B[H" || data === "\x1BOH") return "home";
  if (data === "\x1B[F" || data === "\x1BOF") return "end";
  if (data === "\x1B[3~") return "delete";
  if (data === "\x1B[5~") return "pageUp";
  if (data === "\x1B[6~") return "pageDown";
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return `ctrl+${String.fromCharCode(code + 96)}`;
    }
    if (code >= 32 && code <= 126) {
      return data;
    }
  }
  return void 0;
}
var KITTY_CSI_U_REGEX = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/;
var KITTY_PRINTABLE_ALLOWED_MODIFIERS = MODIFIERS.shift | LOCK_MASK;
function decodeKittyPrintable(data) {
  const match = data.match(KITTY_CSI_U_REGEX);
  if (!match) return void 0;
  const codepoint = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(codepoint)) return void 0;
  const shiftedKey = match[2] && match[2].length > 0 ? Number.parseInt(match[2], 10) : void 0;
  const modValue = match[4] ? Number.parseInt(match[4], 10) : 1;
  const modifier = Number.isFinite(modValue) ? modValue - 1 : 0;
  if ((modifier & ~KITTY_PRINTABLE_ALLOWED_MODIFIERS) !== 0) return void 0;
  if (modifier & (MODIFIERS.alt | MODIFIERS.ctrl)) return void 0;
  let effectiveCodepoint = codepoint;
  if (modifier & MODIFIERS.shift && typeof shiftedKey === "number") {
    effectiveCodepoint = shiftedKey;
  }
  effectiveCodepoint = normalizeKittyFunctionalCodepoint(effectiveCodepoint);
  if (!Number.isFinite(effectiveCodepoint) || effectiveCodepoint < 32) return void 0;
  try {
    return String.fromCodePoint(effectiveCodepoint);
  } catch {
    return void 0;
  }
}
function decodeModifyOtherKeysPrintable(data) {
  const parsed = parseModifyOtherKeysSequence(data);
  if (!parsed) return void 0;
  const modifier = parsed.modifier & ~LOCK_MASK;
  if ((modifier & ~MODIFIERS.shift) !== 0) return void 0;
  if (!Number.isFinite(parsed.codepoint) || parsed.codepoint < 32) return void 0;
  try {
    return String.fromCodePoint(parsed.codepoint);
  } catch {
    return void 0;
  }
}
function decodePrintableKey(data) {
  return decodeKittyPrintable(data) ?? decodeModifyOtherKeysPrintable(data);
}

// tui/src/keybindings.ts
var TUI_KEYBINDINGS = {
  "tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
  "tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
  "tui.editor.cursorLeft": {
    defaultKeys: ["left", "ctrl+b"],
    description: "Move cursor left"
  },
  "tui.editor.cursorRight": {
    defaultKeys: ["right", "ctrl+f"],
    description: "Move cursor right"
  },
  "tui.editor.cursorWordLeft": {
    defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
    description: "Move cursor word left"
  },
  "tui.editor.cursorWordRight": {
    defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
    description: "Move cursor word right"
  },
  "tui.editor.cursorLineStart": {
    defaultKeys: ["home", "ctrl+a"],
    description: "Move to line start"
  },
  "tui.editor.cursorLineEnd": {
    defaultKeys: ["end", "ctrl+e"],
    description: "Move to line end"
  },
  "tui.editor.jumpForward": {
    defaultKeys: "ctrl+]",
    description: "Jump forward to character"
  },
  "tui.editor.jumpBackward": {
    defaultKeys: "ctrl+alt+]",
    description: "Jump backward to character"
  },
  "tui.editor.pageUp": { defaultKeys: "pageUp", description: "Page up" },
  "tui.editor.pageDown": { defaultKeys: "pageDown", description: "Page down" },
  "tui.editor.deleteCharBackward": {
    defaultKeys: "backspace",
    description: "Delete character backward"
  },
  "tui.editor.deleteCharForward": {
    defaultKeys: ["delete", "ctrl+d"],
    description: "Delete character forward"
  },
  "tui.editor.deleteWordBackward": {
    defaultKeys: ["ctrl+w", "alt+backspace"],
    description: "Delete word backward"
  },
  "tui.editor.deleteWordForward": {
    defaultKeys: ["alt+d", "alt+delete"],
    description: "Delete word forward"
  },
  "tui.editor.deleteToLineStart": {
    defaultKeys: "ctrl+u",
    description: "Delete to line start"
  },
  "tui.editor.deleteToLineEnd": {
    defaultKeys: "ctrl+k",
    description: "Delete to line end"
  },
  "tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank" },
  "tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
  "tui.editor.undo": { defaultKeys: "ctrl+-", description: "Undo" },
  "tui.input.newLine": { defaultKeys: ["shift+enter", "ctrl+j"], description: "Insert newline" },
  "tui.input.submit": { defaultKeys: "enter", description: "Submit input" },
  "tui.input.tab": { defaultKeys: "tab", description: "Tab / autocomplete" },
  "tui.input.copy": { defaultKeys: "ctrl+c", description: "Copy selection" },
  "tui.select.up": { defaultKeys: "up", description: "Move selection up" },
  "tui.select.down": { defaultKeys: "down", description: "Move selection down" },
  "tui.select.pageUp": { defaultKeys: "pageUp", description: "Selection page up" },
  "tui.select.pageDown": {
    defaultKeys: "pageDown",
    description: "Selection page down"
  },
  "tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
  "tui.select.cancel": {
    defaultKeys: ["escape", "ctrl+c"],
    description: "Cancel selection"
  },
  "tui.altScreen.pageUp": { defaultKeys: "shift+pageUp", description: "Scroll viewport up one page" },
  "tui.altScreen.pageDown": { defaultKeys: "shift+pageDown", description: "Scroll viewport down one page" },
  "tui.altScreen.top": { defaultKeys: "ctrl+home", description: "Scroll viewport to top" },
  "tui.altScreen.bottom": { defaultKeys: "ctrl+end", description: "Scroll viewport to bottom" }
};
function normalizeKeys(keys) {
  if (keys === void 0) return [];
  const keyList = Array.isArray(keys) ? keys : [keys];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const key of keyList) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}
var KeybindingsManager = class {
  definitions;
  userBindings;
  keysById = /* @__PURE__ */ new Map();
  conflicts = [];
  constructor(definitions, userBindings = {}) {
    this.definitions = definitions;
    this.userBindings = userBindings;
    this.rebuild();
  }
  rebuild() {
    this.keysById.clear();
    this.conflicts = [];
    const userClaims = /* @__PURE__ */ new Map();
    for (const [keybinding, keys] of Object.entries(this.userBindings)) {
      if (!(keybinding in this.definitions)) continue;
      for (const key of normalizeKeys(keys)) {
        const claimants = userClaims.get(key) ?? /* @__PURE__ */ new Set();
        claimants.add(keybinding);
        userClaims.set(key, claimants);
      }
    }
    for (const [key, keybindings] of userClaims) {
      if (keybindings.size > 1) {
        this.conflicts.push({ key, keybindings: [...keybindings] });
      }
    }
    for (const [id, definition] of Object.entries(this.definitions)) {
      const userKeys = this.userBindings[id];
      const keys = userKeys === void 0 ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
      this.keysById.set(id, keys);
    }
  }
  matches(data, keybinding) {
    const keys = this.keysById.get(keybinding) ?? [];
    for (const key of keys) {
      if (matchesKey(data, key)) return true;
    }
    return false;
  }
  getKeys(keybinding) {
    return [...this.keysById.get(keybinding) ?? []];
  }
  getDefinition(keybinding) {
    return this.definitions[keybinding];
  }
  getConflicts() {
    return this.conflicts.map((conflict) => ({ ...conflict, keybindings: [...conflict.keybindings] }));
  }
  setUserBindings(userBindings) {
    this.userBindings = userBindings;
    this.rebuild();
  }
  getUserBindings() {
    return { ...this.userBindings };
  }
  getResolvedBindings() {
    const resolved = {};
    for (const id of Object.keys(this.definitions)) {
      const keys = this.keysById.get(id) ?? [];
      resolved[id] = keys.length === 1 ? keys[0] : [...keys];
    }
    return resolved;
  }
};
var globalKeybindings = null;
function setKeybindings(keybindings) {
  globalKeybindings = keybindings;
}
function getKeybindings() {
  if (!globalKeybindings) {
    globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  }
  return globalKeybindings;
}

// tui/src/components/text.ts
var Text = class {
  text;
  paddingX;
  // Left/right padding
  paddingY;
  // Top/bottom padding
  customBgFn;
  // Cache for rendered output
  cachedText;
  cachedWidth;
  cachedLines;
  constructor(text = "", paddingX = 1, paddingY = 1, customBgFn) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.customBgFn = customBgFn;
  }
  setText(text) {
    this.text = text;
    this.cachedText = void 0;
    this.cachedWidth = void 0;
    this.cachedLines = void 0;
  }
  setCustomBgFn(customBgFn) {
    this.customBgFn = customBgFn;
    this.cachedText = void 0;
    this.cachedWidth = void 0;
    this.cachedLines = void 0;
  }
  invalidate() {
    this.cachedText = void 0;
    this.cachedWidth = void 0;
    this.cachedLines = void 0;
  }
  render(width) {
    if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
      return this.cachedLines;
    }
    if (!this.text || this.text.trim() === "") {
      const result2 = [];
      this.cachedText = this.text;
      this.cachedWidth = width;
      this.cachedLines = result2;
      return result2;
    }
    const normalizedText = this.text.replace(/\t/g, "   ");
    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const wrappedLines = wrapTextWithAnsi(normalizedText, contentWidth);
    const leftMargin = " ".repeat(this.paddingX);
    const rightMargin = " ".repeat(this.paddingX);
    const contentLines = [];
    for (const line of wrappedLines) {
      const lineWithMargins = leftMargin + line + rightMargin;
      if (this.customBgFn) {
        contentLines.push(applyBackgroundToLine(lineWithMargins, width, this.customBgFn));
      } else {
        const visibleLen = visibleWidth(lineWithMargins);
        const paddingNeeded = Math.max(0, width - visibleLen);
        contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
      }
    }
    const emptyLine = " ".repeat(width);
    const emptyLines = [];
    for (let i = 0; i < this.paddingY; i++) {
      const line = this.customBgFn ? applyBackgroundToLine(emptyLine, width, this.customBgFn) : emptyLine;
      emptyLines.push(line);
    }
    const result = [...emptyLines, ...contentLines, ...emptyLines];
    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = result;
    return result.length > 0 ? result : [""];
  }
};

// tui/src/components/loader.ts
var DEFAULT_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var DEFAULT_INTERVAL_MS = 80;
var Loader = class extends Text {
  frames = [...DEFAULT_FRAMES];
  intervalMs = DEFAULT_INTERVAL_MS;
  currentFrame = 0;
  intervalId = null;
  ui = null;
  renderIndicatorVerbatim = false;
  spinnerColorFn;
  messageColorFn;
  message = "Loading...";
  constructor(ui, spinnerColorFn, messageColorFn, message = "Loading...", indicator) {
    super("", 1, 0);
    this.ui = ui;
    this.spinnerColorFn = spinnerColorFn;
    this.messageColorFn = messageColorFn;
    this.message = message;
    this.setIndicator(indicator);
  }
  render(width) {
    return ["", ...super.render(width)];
  }
  start() {
    this.updateDisplay();
    this.restartAnimation();
  }
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  setMessage(message) {
    this.message = message;
    this.updateDisplay();
  }
  setIndicator(indicator) {
    this.renderIndicatorVerbatim = indicator !== void 0;
    this.frames = indicator?.frames !== void 0 ? [...indicator.frames] : [...DEFAULT_FRAMES];
    this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : DEFAULT_INTERVAL_MS;
    this.currentFrame = 0;
    this.start();
  }
  restartAnimation() {
    this.stop();
    if (this.frames.length <= 1) {
      return;
    }
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.updateDisplay();
    }, this.intervalMs);
  }
  updateDisplay() {
    const frame = this.frames[this.currentFrame] ?? "";
    const renderedFrame = this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame);
    const indicator = frame.length > 0 ? `${renderedFrame} ` : "";
    this.setText(`${indicator}${this.messageColorFn(this.message)}`);
    if (this.ui) {
      this.ui.requestRender();
    }
  }
};

// tui/src/components/cancellable-loader.ts
var CancellableLoader = class extends Loader {
  abortController = new AbortController();
  /** Called when user presses Escape */
  onAbort;
  /** AbortSignal that is aborted when user presses Escape */
  get signal() {
    return this.abortController.signal;
  }
  /** Whether the loader was aborted */
  get aborted() {
    return this.abortController.signal.aborted;
  }
  handleInput(data) {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.cancel")) {
      this.abortController.abort();
      this.onAbort?.();
    }
  }
  dispose() {
    this.stop();
  }
};

// tui/src/kill-ring.ts
var KillRing = class {
  ring = [];
  /**
   * Add text to the kill ring.
   *
   * @param text - The killed text to add
   * @param opts - Push options
   * @param opts.prepend - If accumulating, prepend (backward deletion) or append (forward deletion)
   * @param opts.accumulate - Merge with the most recent entry instead of creating a new one
   */
  push(text, opts) {
    if (!text) return;
    if (opts.accumulate && this.ring.length > 0) {
      const last = this.ring.pop();
      this.ring.push(opts.prepend ? text + last : last + text);
    } else {
      this.ring.push(text);
    }
  }
  /** Get most recent entry without modifying the ring. */
  peek() {
    return this.ring.length > 0 ? this.ring[this.ring.length - 1] : void 0;
  }
  /** Move last entry to front (for yank-pop cycling). */
  rotate() {
    if (this.ring.length > 1) {
      const last = this.ring.pop();
      this.ring.unshift(last);
    }
  }
  get length() {
    return this.ring.length;
  }
};

// tui/src/tui.ts
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

// tui/src/terminal-colors.ts
function hexToRgb(hex) {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
}
function parseOscHexChannel(channel) {
  if (!/^[0-9a-f]+$/i.test(channel)) {
    return void 0;
  }
  const max = 16 ** channel.length - 1;
  if (max <= 0) {
    return void 0;
  }
  return Math.round(parseInt(channel, 16) / max * 255);
}
var OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN = /^\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)$/i;
var COLOR_SCHEME_REPORT_PATTERN = /^\x1b\[\?997;(1|2)n$/;
function isOsc11BackgroundColorResponse(data) {
  return OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN.test(data);
}
function parseOsc11BackgroundColor(data) {
  const match = data.match(OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN);
  if (!match) {
    return void 0;
  }
  const value = match[1].trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return hexToRgb(value);
    }
    if (/^[0-9a-f]{12}$/i.test(hex)) {
      const r2 = parseOscHexChannel(hex.slice(0, 4));
      const g2 = parseOscHexChannel(hex.slice(4, 8));
      const b2 = parseOscHexChannel(hex.slice(8, 12));
      return r2 !== void 0 && g2 !== void 0 && b2 !== void 0 ? { r: r2, g: g2, b: b2 } : void 0;
    }
    return void 0;
  }
  const rgbValue = value.replace(/^rgba?:/i, "");
  const [red, green, blue] = rgbValue.split("/");
  if (red === void 0 || green === void 0 || blue === void 0) {
    return void 0;
  }
  const r = parseOscHexChannel(red);
  const g = parseOscHexChannel(green);
  const b = parseOscHexChannel(blue);
  return r !== void 0 && g !== void 0 && b !== void 0 ? { r, g, b } : void 0;
}
function parseTerminalColorSchemeReport(data) {
  const match = data.match(COLOR_SCHEME_REPORT_PATTERN);
  if (!match) {
    return void 0;
  }
  return match[1] === "2" ? "light" : "dark";
}

// tui/src/terminal-image.ts
import { execSync } from "node:child_process";
import { homedir as homedir2 } from "node:os";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
var cachedCapabilities = null;
var cellDimensions = { widthPx: 9, heightPx: 18 };
function getCellDimensions() {
  return cellDimensions;
}
function setCellDimensions(dims) {
  cellDimensions = dims;
}
function probeTmuxHyperlinks() {
  try {
    const termfeatures = execSync("tmux display-message -p '#{client_termfeatures}'", {
      encoding: "utf8",
      timeout: 250,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return termfeatures.split(",").map((feature) => feature.trim()).includes("hyperlinks");
  } catch {
    return false;
  }
}
function detectCapabilities(tmuxForwardsHyperlink = probeTmuxHyperlinks) {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
  const terminalEmulator = process.env.TERMINAL_EMULATOR?.toLowerCase() || "";
  const term = process.env.TERM?.toLowerCase() || "";
  const colorTerm = process.env.COLORTERM?.toLowerCase() || "";
  const hasTrueColorHint = colorTerm === "truecolor" || colorTerm === "24bit";
  if (process.env.TMUX || term.startsWith("tmux")) {
    return { images: null, trueColor: hasTrueColorHint, hyperlinks: tmuxForwardsHyperlink() };
  }
  if (term.startsWith("screen")) {
    return { images: null, trueColor: hasTrueColorHint, hyperlinks: false };
  }
  if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (termProgram === "ghostty" || term.includes("ghostty") || process.env.GHOSTTY_RESOURCES_DIR) {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (process.env.WEZTERM_PANE || termProgram === "wezterm") {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (termProgram === "warpterminal" || process.env.WARP_SESSION_ID || process.env.WARP_TERMINAL_SESSION_UUID) {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") {
    return { images: "iterm2", trueColor: true, hyperlinks: true };
  }
  if (process.env.WT_SESSION) {
    return { images: null, trueColor: true, hyperlinks: true };
  }
  if (termProgram === "vscode") {
    return { images: null, trueColor: true, hyperlinks: true };
  }
  if (termProgram === "alacritty") {
    return { images: null, trueColor: true, hyperlinks: true };
  }
  if (terminalEmulator === "jetbrains-jediterm") {
    return { images: null, trueColor: true, hyperlinks: false };
  }
  return { images: null, trueColor: hasTrueColorHint, hyperlinks: false };
}
function getCapabilities() {
  if (!cachedCapabilities) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}
function resetCapabilitiesCache() {
  cachedCapabilities = null;
}
function setCapabilities(caps) {
  cachedCapabilities = caps;
}
var KITTY_PREFIX = "\x1B_G";
var ITERM2_PREFIX = "\x1B]1337;File=";
function isImageLine(line) {
  if (line.startsWith(KITTY_PREFIX) || line.startsWith(ITERM2_PREFIX)) {
    return true;
  }
  return line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX);
}
function allocateImageId() {
  return Math.floor(Math.random() * 4294967294) + 1;
}
function encodeKitty(base64Data, options = {}) {
  const CHUNK_SIZE = 4096;
  const params = ["a=T", "f=100", "q=2"];
  if (options.moveCursor === false) params.push("C=1");
  if (options.columns) params.push(`c=${options.columns}`);
  if (options.rows) params.push(`r=${options.rows}`);
  if (options.imageId) params.push(`i=${options.imageId}`);
  if (base64Data.length <= CHUNK_SIZE) {
    return `\x1B_G${params.join(",")};${base64Data}\x1B\\`;
  }
  const chunks = [];
  let offset = 0;
  let isFirst = true;
  while (offset < base64Data.length) {
    const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
    const isLast = offset + CHUNK_SIZE >= base64Data.length;
    if (isFirst) {
      chunks.push(`\x1B_G${params.join(",")},m=1;${chunk}\x1B\\`);
      isFirst = false;
    } else if (isLast) {
      chunks.push(`\x1B_Gm=0;${chunk}\x1B\\`);
    } else {
      chunks.push(`\x1B_Gm=1;${chunk}\x1B\\`);
    }
    offset += CHUNK_SIZE;
  }
  return chunks.join("");
}
function deleteKittyImage(imageId) {
  return `\x1B_Ga=d,d=I,i=${imageId},q=2\x1B\\`;
}
function deleteAllKittyImages() {
  return "\x1B_Ga=d,d=A,q=2\x1B\\";
}
function encodeITerm2(base64Data, options = {}) {
  const params = [`inline=${options.inline !== false ? 1 : 0}`];
  if (options.width !== void 0) params.push(`width=${options.width}`);
  if (options.height !== void 0) params.push(`height=${options.height}`);
  if (options.name) {
    const nameBase64 = Buffer.from(options.name).toString("base64");
    params.push(`name=${nameBase64}`);
  }
  if (options.preserveAspectRatio === false) {
    params.push("preserveAspectRatio=0");
  }
  return `\x1B]1337;File=${params.join(";")}:${base64Data}\x07`;
}
var kittyImageMetadata = /* @__PURE__ */ new Map();
function registerKittyImageMetadata(metadata) {
  kittyImageMetadata.delete(metadata.imageId);
  kittyImageMetadata.set(metadata.imageId, metadata);
  if (kittyImageMetadata.size > 1e3) {
    const oldestImageId = kittyImageMetadata.keys().next().value;
    if (oldestImageId !== void 0) kittyImageMetadata.delete(oldestImageId);
  }
}
function getKittyImageMetadata(line) {
  const controls = /\x1b_G([^;]*);/.exec(line)?.[1];
  if (!controls) return void 0;
  const imageId = /(?:^|,)i=(\d+)(?:,|$)/.exec(controls)?.[1];
  return imageId === void 0 ? void 0 : kittyImageMetadata.get(Number.parseInt(imageId, 10));
}
function cropKittyImageLine(line, hiddenRows, visibleRows) {
  const metadata = getKittyImageMetadata(line);
  const match = /\x1b_G([^;]*);/.exec(line);
  if (!metadata || !match || hiddenRows <= 0 || visibleRows <= 0) return line;
  const sourceY = Math.floor(metadata.heightPx * hiddenRows / metadata.rows);
  const sourceEnd = Math.ceil(metadata.heightPx * (hiddenRows + visibleRows) / metadata.rows);
  const sourceHeight = Math.max(1, Math.min(metadata.heightPx, sourceEnd) - sourceY);
  const controls = match[1].split(",").filter((control) => !/^[yhr]=/.test(control));
  controls.push(`y=${sourceY}`, `h=${sourceHeight}`, `r=${visibleRows}`);
  return `${line.slice(0, match.index)}\x1B_G${controls.join(",")};${line.slice(match.index + match[0].length)}`;
}
function calculateImageCellSize(imageDimensions, maxWidthCells, maxHeightCells, cellDimensions2 = { widthPx: 9, heightPx: 18 }) {
  const maxWidth = Math.max(1, Math.floor(maxWidthCells));
  const maxHeight = maxHeightCells === void 0 ? void 0 : Math.max(1, Math.floor(maxHeightCells));
  const imageWidth = Math.max(1, imageDimensions.widthPx);
  const imageHeight = Math.max(1, imageDimensions.heightPx);
  const widthScale = maxWidth * cellDimensions2.widthPx / imageWidth;
  const heightScale = maxHeight === void 0 ? widthScale : maxHeight * cellDimensions2.heightPx / imageHeight;
  const scale = Math.min(widthScale, heightScale);
  const scaledWidthPx = imageWidth * scale;
  const scaledHeightPx = imageHeight * scale;
  const columns = Math.ceil(scaledWidthPx / cellDimensions2.widthPx);
  const rows = Math.ceil(scaledHeightPx / cellDimensions2.heightPx);
  return {
    columns: Math.max(1, Math.min(maxWidth, columns)),
    rows: Math.max(1, maxHeight === void 0 ? rows : Math.min(maxHeight, rows))
  };
}
function calculateImageRows(imageDimensions, targetWidthCells, cellDimensions2 = { widthPx: 9, heightPx: 18 }) {
  return calculateImageCellSize(imageDimensions, targetWidthCells, void 0, cellDimensions2).rows;
}
function getPngDimensions(base64Data) {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 24) {
      return null;
    }
    if (buffer[0] !== 137 || buffer[1] !== 80 || buffer[2] !== 78 || buffer[3] !== 71) {
      return null;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { widthPx: width, heightPx: height };
  } catch {
    return null;
  }
}
function getJpegDimensions(base64Data) {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 2) {
      return null;
    }
    if (buffer[0] !== 255 || buffer[1] !== 216) {
      return null;
    }
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 255) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker >= 192 && marker <= 194) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { widthPx: width, heightPx: height };
      }
      if (offset + 3 >= buffer.length) {
        return null;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) {
        return null;
      }
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}
function getGifDimensions(base64Data) {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 10) {
      return null;
    }
    const sig = buffer.slice(0, 6).toString("ascii");
    if (sig !== "GIF87a" && sig !== "GIF89a") {
      return null;
    }
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { widthPx: width, heightPx: height };
  } catch {
    return null;
  }
}
function getWebpDimensions(base64Data) {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 30) {
      return null;
    }
    const riff = buffer.slice(0, 4).toString("ascii");
    const webp = buffer.slice(8, 12).toString("ascii");
    if (riff !== "RIFF" || webp !== "WEBP") {
      return null;
    }
    const chunk = buffer.slice(12, 16).toString("ascii");
    if (chunk === "VP8 ") {
      if (buffer.length < 30) return null;
      const width = buffer.readUInt16LE(26) & 16383;
      const height = buffer.readUInt16LE(28) & 16383;
      return { widthPx: width, heightPx: height };
    } else if (chunk === "VP8L") {
      if (buffer.length < 25) return null;
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 16383) + 1;
      const height = (bits >> 14 & 16383) + 1;
      return { widthPx: width, heightPx: height };
    } else if (chunk === "VP8X") {
      if (buffer.length < 30) return null;
      const width = (buffer[24] | buffer[25] << 8 | buffer[26] << 16) + 1;
      const height = (buffer[27] | buffer[28] << 8 | buffer[29] << 16) + 1;
      return { widthPx: width, heightPx: height };
    }
    return null;
  } catch {
    return null;
  }
}
function getImageDimensions(base64Data, mimeType) {
  if (mimeType === "image/png") {
    return getPngDimensions(base64Data);
  }
  if (mimeType === "image/jpeg") {
    return getJpegDimensions(base64Data);
  }
  if (mimeType === "image/gif") {
    return getGifDimensions(base64Data);
  }
  if (mimeType === "image/webp") {
    return getWebpDimensions(base64Data);
  }
  return null;
}
function renderImage(base64Data, imageDimensions, options = {}) {
  const caps = getCapabilities();
  if (!caps.images) {
    return null;
  }
  const maxWidth = options.maxWidthCells ?? 80;
  const size = calculateImageCellSize(imageDimensions, maxWidth, options.maxHeightCells, getCellDimensions());
  if (caps.images === "kitty") {
    if (options.imageId !== void 0) {
      registerKittyImageMetadata({
        imageId: options.imageId,
        columns: size.columns,
        rows: size.rows,
        widthPx: imageDimensions.widthPx,
        heightPx: imageDimensions.heightPx
      });
    }
    const sequence = encodeKitty(base64Data, {
      columns: size.columns,
      rows: size.rows,
      imageId: options.imageId,
      moveCursor: options.moveCursor
    });
    return { sequence, columns: size.columns, rows: size.rows, imageId: options.imageId };
  }
  if (caps.images === "iterm2") {
    const sequence = encodeITerm2(base64Data, {
      width: size.columns,
      height: "auto",
      preserveAspectRatio: options.preserveAspectRatio ?? true
    });
    return { sequence, columns: size.columns, rows: size.rows };
  }
  return null;
}
function hyperlink(text, url) {
  return `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\`;
}
function shortenImagePath(filename) {
  const home = homedir2();
  if (home && (filename === home || filename.startsWith(`${home}/`) || filename.startsWith(`${home}\\`))) {
    return `~${filename.slice(home.length)}`;
  }
  return filename;
}
function imageFallback(mimeType, dimensions, filename) {
  const parts = [];
  if (filename) {
    const display = shortenImagePath(filename);
    if (getCapabilities().hyperlinks && isAbsolute(filename)) {
      parts.push(hyperlink(display, pathToFileURL(filename).href));
    } else {
      parts.push(display);
    }
  }
  parts.push(`[${mimeType}]`);
  if (dimensions) parts.push(`${dimensions.widthPx}x${dimensions.heightPx}`);
  return `[Image: ${parts.join(" ")}]`;
}

// tui/src/tui.ts
function isFocusable(component) {
  return component !== null && "focused" in component;
}
var CURSOR_MARKER = "\x1B_pi:c\x07";
function parseSizeValue(value, referenceSize) {
  if (value === void 0) return void 0;
  if (typeof value === "number") return value;
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) {
    return Math.floor(referenceSize * parseFloat(match[1]) / 100);
  }
  return void 0;
}
var Container = class {
  children = [];
  addChild(component) {
    this.children.push(component);
  }
  removeChild(component) {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }
  clear() {
    this.children = [];
  }
  invalidate() {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }
  render(width) {
    const lines = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      for (const line of childLines) {
        lines.push(line);
      }
    }
    return lines;
  }
};
var SEGMENT_RESET = "\x1B[0m\x1B]8;;\x07";
function compositeTuiLine(baseLine, overlayLine, startCol, overlayWidth, totalWidth) {
  if (isImageLine(baseLine)) return baseLine;
  const afterStart = startCol + overlayWidth;
  const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);
  const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);
  const beforePad = Math.max(0, startCol - base.beforeWidth);
  const overlayPad = Math.max(0, overlayWidth - overlay.width);
  const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
  const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
  const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
  const afterPad = Math.max(0, afterTarget - base.afterWidth);
  const result = base.before + " ".repeat(beforePad) + SEGMENT_RESET + overlay.text + " ".repeat(overlayPad) + SEGMENT_RESET + base.after + " ".repeat(afterPad);
  return visibleWidth(result) <= totalWidth ? result : sliceByColumn(result, 0, totalWidth, true);
}
var TuiBase = class _TuiBase extends Container {
  terminal;
  focusedComponent = null;
  inputListeners = /* @__PURE__ */ new Set();
  /** Global callback for debug key (Shift+Ctrl+D). Called before input is forwarded to focused component. */
  onDebug;
  renderRequested = false;
  renderTimer;
  lastRenderAt = 0;
  static MIN_RENDER_INTERVAL_MS = 16;
  showHardwareCursor = process.env.PI_HARDWARE_CURSOR === "1";
  clearOnShrink = process.env.PI_CLEAR_ON_SHRINK === "1";
  fullRedrawCount = 0;
  stopped = false;
  pendingOsc11BackgroundReplies = 0;
  pendingOsc11BackgroundQueries = [];
  terminalColorSchemeListeners = /* @__PURE__ */ new Set();
  terminalColorSchemeNotificationsEnabled = false;
  logDirectory;
  // Overlay stack for modal components rendered on top of base content
  focusOrderCounter = 0;
  overlayStack = [];
  get hasOverlayEntries() {
    return this.overlayStack.length > 0;
  }
  overlayFocusRestore = { status: "inactive" };
  constructor(terminal, showHardwareCursor, logDirectory) {
    super();
    this.terminal = terminal;
    this.logDirectory = logDirectory ?? process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
    if (showHardwareCursor !== void 0) {
      this.showHardwareCursor = showHardwareCursor;
    }
  }
  resetRenderState() {
  }
  beforeTerminalStart() {
  }
  afterTerminalStart() {
  }
  beforeTerminalStop() {
  }
  afterTerminalStop() {
  }
  get fullRedraws() {
    return this.fullRedrawCount;
  }
  getShowHardwareCursor() {
    return this.showHardwareCursor;
  }
  setShowHardwareCursor(enabled) {
    if (this.showHardwareCursor === enabled) return;
    this.showHardwareCursor = enabled;
    if (!enabled) {
      this.terminal.hideCursor();
    }
    this.requestRender();
  }
  getClearOnShrink() {
    return this.clearOnShrink;
  }
  /**
   * Set whether to trigger full re-render when content shrinks.
   * When true (default), empty rows are cleared when content shrinks.
   * When false, empty rows remain (reduces redraws on slower terminals).
   */
  setClearOnShrink(enabled) {
    this.clearOnShrink = enabled;
  }
  setFocus(component) {
    this.setFocusInternal({ component, overlayFocusRestore: "clear" });
  }
  setFocusInternal({
    component,
    overlayFocusRestore
  }) {
    const previousFocus = this.focusedComponent;
    let nextFocus = component;
    const previousFocusedOverlay = previousFocus ? this.overlayStack.find((entry) => entry.component === previousFocus && this.isOverlayVisible(entry)) : void 0;
    const nextFocusIsOverlay = nextFocus ? this.overlayStack.some((entry) => entry.component === nextFocus) : false;
    const restoreState = this.getVisibleOverlayFocusRestore();
    if (nextFocus && !nextFocusIsOverlay) {
      if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
        if (restoreState.resume.status === "focus-target" || !this.isComponentMounted(restoreState.blockedBy)) {
          nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
        } else {
          this.overlayFocusRestore = {
            status: "blocked",
            overlay: restoreState.overlay,
            blockedBy: nextFocus,
            resume: restoreState.resume
          };
        }
      } else if (previousFocusedOverlay && restoreState.status !== "inactive" && restoreState.overlay === previousFocusedOverlay && !this.isOverlayFocusAncestor(previousFocusedOverlay, nextFocus)) {
        this.overlayFocusRestore = {
          status: "blocked",
          overlay: previousFocusedOverlay,
          blockedBy: nextFocus,
          resume: { status: "restore-overlay" }
        };
      }
    } else if (nextFocus === null) {
      if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
        nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
      } else if (overlayFocusRestore === "clear") {
        this.clearOverlayFocusRestore();
      }
    }
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = nextFocus;
    if (isFocusable(nextFocus)) {
      nextFocus.focused = true;
    }
    const focusedOverlay = nextFocus ? this.overlayStack.find((entry) => entry.component === nextFocus && this.isOverlayVisible(entry)) : void 0;
    if (focusedOverlay) {
      this.overlayFocusRestore = { status: "eligible", overlay: focusedOverlay };
    }
  }
  clearOverlayFocusRestore() {
    this.overlayFocusRestore = { status: "inactive" };
  }
  clearOverlayFocusRestoreFor(overlay) {
    if (this.overlayFocusRestore.status !== "inactive" && this.overlayFocusRestore.overlay === overlay) {
      this.clearOverlayFocusRestore();
    }
  }
  resolveBlockedOverlayFocusResume(restoreState) {
    if (restoreState.resume.status === "restore-overlay") return restoreState.overlay.component;
    this.clearOverlayFocusRestore();
    return restoreState.resume.target;
  }
  getVisibleOverlayFocusRestore() {
    const restoreState = this.overlayFocusRestore;
    if (restoreState.status === "inactive") return restoreState;
    if (!this.overlayStack.includes(restoreState.overlay) || !this.isOverlayVisible(restoreState.overlay)) {
      return { status: "inactive" };
    }
    return restoreState;
  }
  isOverlayFocusAncestor(entry, component) {
    const visited = /* @__PURE__ */ new Set();
    let current = entry.preFocus;
    while (current && !visited.has(current)) {
      visited.add(current);
      if (current === component) return true;
      current = this.overlayStack.find((overlay) => overlay.component === current)?.preFocus ?? null;
    }
    return false;
  }
  retargetOverlayPreFocus(removed) {
    for (const overlay of this.overlayStack) {
      if (overlay !== removed && overlay.preFocus === removed.component) {
        overlay.preFocus = removed.preFocus;
      }
    }
  }
  isComponentMounted(component) {
    return this.children.some((child) => this.containsComponent(child, component));
  }
  containsComponent(root, target) {
    if (root === target) return true;
    if (!(root instanceof Container)) return false;
    return root.children.some((child) => this.containsComponent(child, target));
  }
  /**
   * Show an overlay component with configurable positioning and sizing.
   * Returns a handle to control the overlay's visibility.
   */
  showOverlay(component, options) {
    const entry = {
      component,
      ...options === void 0 ? {} : { options },
      preFocus: this.focusedComponent,
      hidden: false,
      focusOrder: ++this.focusOrderCounter
    };
    this.overlayStack.push(entry);
    if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
      this.setFocus(component);
    }
    this.terminal.hideCursor();
    this.requestRender();
    return {
      hide: () => {
        const index = this.overlayStack.indexOf(entry);
        if (index !== -1) {
          this.clearOverlayFocusRestoreFor(entry);
          this.retargetOverlayPreFocus(entry);
          this.overlayStack.splice(index, 1);
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
          if (this.overlayStack.length === 0) this.terminal.hideCursor();
          this.requestRender();
        }
      },
      setHidden: (hidden) => {
        if (entry.hidden === hidden) return;
        entry.hidden = hidden;
        if (hidden) {
          this.clearOverlayFocusRestoreFor(entry);
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
        } else {
          if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
            entry.focusOrder = ++this.focusOrderCounter;
            this.setFocus(component);
          }
        }
        this.requestRender();
      },
      isHidden: () => entry.hidden,
      focus: () => {
        if (!this.overlayStack.includes(entry) || !this.isOverlayVisible(entry)) return;
        entry.focusOrder = ++this.focusOrderCounter;
        this.setFocus(component);
        this.requestRender();
      },
      unfocus: (unfocusOptions) => {
        const isFocused = this.focusedComponent === component;
        const restoreState = this.overlayFocusRestore;
        const hasPendingRestore = restoreState.status !== "inactive" && restoreState.overlay === entry;
        if (!isFocused && !hasPendingRestore) return;
        if (restoreState.status === "blocked" && restoreState.overlay === entry && this.focusedComponent === restoreState.blockedBy) {
          if (unfocusOptions) {
            this.overlayFocusRestore = {
              status: "blocked",
              overlay: entry,
              blockedBy: restoreState.blockedBy,
              resume: { status: "focus-target", target: unfocusOptions.target }
            };
          } else {
            this.clearOverlayFocusRestore();
          }
          this.requestRender();
          return;
        }
        this.clearOverlayFocusRestoreFor(entry);
        if (isFocused || unfocusOptions) {
          const topVisible = this.getTopmostVisibleOverlay();
          const fallbackTarget = topVisible && topVisible !== entry ? topVisible.component : entry.preFocus;
          this.setFocus(unfocusOptions ? unfocusOptions.target : fallbackTarget);
        }
        this.requestRender();
      },
      isFocused: () => this.focusedComponent === component
    };
  }
  /** Hide the topmost overlay and restore previous focus. */
  hideOverlay() {
    const overlay = this.overlayStack[this.overlayStack.length - 1];
    if (!overlay) return;
    this.clearOverlayFocusRestoreFor(overlay);
    this.retargetOverlayPreFocus(overlay);
    this.overlayStack.pop();
    if (this.focusedComponent === overlay.component) {
      const topVisible = this.getTopmostVisibleOverlay();
      this.setFocus(topVisible?.component ?? overlay.preFocus);
    }
    if (this.overlayStack.length === 0) this.terminal.hideCursor();
    this.requestRender();
  }
  /** Check if there are any visible overlays */
  hasOverlay() {
    return this.overlayStack.some((o) => this.isOverlayVisible(o));
  }
  /** Check if an overlay entry is currently visible */
  isOverlayVisible(entry) {
    if (entry.hidden) return false;
    if (entry.options?.visible) {
      return entry.options.visible(this.terminal.columns, this.terminal.rows);
    }
    return true;
  }
  /** Find the visual-frontmost visible capturing overlay, if any */
  getTopmostVisibleOverlay() {
    let topmost;
    for (const overlay of this.overlayStack) {
      if (overlay.options?.nonCapturing || !this.isOverlayVisible(overlay)) continue;
      if (!topmost || overlay.focusOrder > topmost.focusOrder) {
        topmost = overlay;
      }
    }
    return topmost;
  }
  invalidate() {
    super.invalidate();
    for (const overlay of this.overlayStack) overlay.component.invalidate?.();
  }
  start() {
    this.stopped = false;
    this.beforeTerminalStart();
    this.terminal.start(
      (data) => this.handleTerminalInput(data),
      () => this.requestRender()
    );
    this.afterTerminalStart();
    this.terminal.hideCursor();
    if (this.terminalColorSchemeNotificationsEnabled) {
      this.terminal.write("\x1B[?2031h");
    }
    this.queryCellSize();
    this.requestRender();
  }
  addInputListener(listener) {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }
  removeInputListener(listener) {
    this.inputListeners.delete(listener);
  }
  onTerminalColorSchemeChange(listener) {
    this.terminalColorSchemeListeners.add(listener);
    return () => {
      this.terminalColorSchemeListeners.delete(listener);
    };
  }
  setTerminalColorSchemeNotifications(enabled) {
    if (this.terminalColorSchemeNotificationsEnabled === enabled) {
      return;
    }
    this.terminalColorSchemeNotificationsEnabled = enabled;
    if (!this.stopped) {
      this.terminal.write(enabled ? "\x1B[?2031h" : "\x1B[?2031l");
    }
  }
  queryCellSize() {
    if (!getCapabilities().images) {
      return;
    }
    this.terminal.write("\x1B[16t");
  }
  stop() {
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = void 0;
    }
    if (this.terminalColorSchemeNotificationsEnabled) {
      this.terminal.write("\x1B[?2031l");
    }
    this.beforeTerminalStop();
    this.terminal.showCursor();
    this.terminal.stop();
    this.afterTerminalStop();
  }
  requestRender(force = false) {
    if (force) {
      this.resetRenderState();
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = void 0;
      }
      this.renderRequested = true;
      process.nextTick(() => {
        if (this.stopped || !this.renderRequested) {
          return;
        }
        this.renderRequested = false;
        this.lastRenderAt = performance.now();
        this.doRender();
      });
      return;
    }
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => this.scheduleRender());
  }
  scheduleRender() {
    if (this.stopped || this.renderTimer || !this.renderRequested) {
      return;
    }
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, _TuiBase.MIN_RENDER_INTERVAL_MS - elapsed);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = void 0;
      if (this.stopped || !this.renderRequested) {
        return;
      }
      this.renderRequested = false;
      this.lastRenderAt = performance.now();
      this.doRender();
      if (this.renderRequested) {
        this.scheduleRender();
      }
    }, delay);
  }
  handleTerminalInput(data) {
    if (this.consumeOsc11BackgroundResponse(data)) {
      return;
    }
    if (this.consumeTerminalColorSchemeReport(data)) {
      return;
    }
    if (this.inputListeners.size > 0) {
      let current = data;
      for (const listener of this.inputListeners) {
        const result = listener(current);
        if (result?.consume) {
          return;
        }
        if (result?.data !== void 0) {
          current = result.data;
        }
      }
      if (current.length === 0) {
        return;
      }
      data = current;
    }
    if (this.consumeCellSizeResponse(data)) {
      return;
    }
    if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
      this.onDebug();
      return;
    }
    const focusedOverlay = this.overlayStack.find((o) => o.component === this.focusedComponent);
    if (focusedOverlay && !this.isOverlayVisible(focusedOverlay)) {
      const topVisible = this.getTopmostVisibleOverlay();
      if (topVisible) {
        this.setFocus(topVisible.component);
      } else {
        this.setFocusInternal({ component: focusedOverlay.preFocus, overlayFocusRestore: "preserve" });
      }
    }
    const focusIsOverlay = this.overlayStack.some((o) => o.component === this.focusedComponent);
    if (!focusIsOverlay) {
      const restoreState = this.getVisibleOverlayFocusRestore();
      if (restoreState.status === "eligible") {
        this.setFocus(restoreState.overlay.component);
      } else if (restoreState.status === "blocked" && restoreState.blockedBy !== this.focusedComponent) {
        if (restoreState.resume.status === "restore-overlay") {
          this.setFocus(restoreState.overlay.component);
        } else {
          this.clearOverlayFocusRestore();
          this.setFocus(restoreState.resume.target);
        }
      }
    }
    if (this.focusedComponent?.handleInput) {
      if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) {
        return;
      }
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }
  consumeOsc11BackgroundResponse(data) {
    if (this.pendingOsc11BackgroundReplies <= 0) {
      return false;
    }
    if (!isOsc11BackgroundColorResponse(data)) {
      return false;
    }
    const rgb = parseOsc11BackgroundColor(data);
    this.pendingOsc11BackgroundReplies -= 1;
    const query = this.pendingOsc11BackgroundQueries.shift();
    if (query && !query.settled) {
      query.settled = true;
      if (query.timer) {
        clearTimeout(query.timer);
        query.timer = void 0;
      }
      query.resolve?.(rgb);
      query.resolve = void 0;
    }
    return true;
  }
  consumeTerminalColorSchemeReport(data) {
    const scheme = parseTerminalColorSchemeReport(data);
    if (!scheme) {
      return false;
    }
    for (const listener of this.terminalColorSchemeListeners) {
      listener(scheme);
    }
    return true;
  }
  consumeCellSizeResponse(data) {
    const match = data.match(/^\x1b\[6;(\d+);(\d+)t$/);
    if (!match) {
      return false;
    }
    const heightPx = parseInt(match[1], 10);
    const widthPx = parseInt(match[2], 10);
    if (heightPx <= 0 || widthPx <= 0) {
      return true;
    }
    setCellDimensions({ widthPx, heightPx });
    this.invalidate();
    this.requestRender();
    return true;
  }
  /**
   * Resolve overlay layout from options.
   * Returns { width, row, col, maxHeight } for rendering.
   */
  resolveOverlayLayout(options, overlayHeight, termWidth, termHeight) {
    const opt = options ?? {};
    const margin = typeof opt.margin === "number" ? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin } : opt.margin ?? {};
    const marginTop = Math.max(0, margin.top ?? 0);
    const marginRight = Math.max(0, margin.right ?? 0);
    const marginBottom = Math.max(0, margin.bottom ?? 0);
    const marginLeft = Math.max(0, margin.left ?? 0);
    const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
    const availHeight = Math.max(1, termHeight - marginTop - marginBottom);
    let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
    if (opt.minWidth !== void 0) {
      width = Math.max(width, opt.minWidth);
    }
    width = Math.max(1, Math.min(width, availWidth));
    let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
    if (maxHeight !== void 0) {
      maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
    }
    const effectiveHeight = maxHeight !== void 0 ? Math.min(overlayHeight, maxHeight) : overlayHeight;
    let row;
    let col;
    if (opt.row !== void 0) {
      if (typeof opt.row === "string") {
        const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
        if (match) {
          const maxRow = Math.max(0, availHeight - effectiveHeight);
          const percent = parseFloat(match[1]) / 100;
          row = marginTop + Math.floor(maxRow * percent);
        } else {
          row = this.resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
        }
      } else {
        row = opt.row;
      }
    } else {
      const anchor = opt.anchor ?? "center";
      row = this.resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
    }
    if (opt.col !== void 0) {
      if (typeof opt.col === "string") {
        const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
        if (match) {
          const maxCol = Math.max(0, availWidth - width);
          const percent = parseFloat(match[1]) / 100;
          col = marginLeft + Math.floor(maxCol * percent);
        } else {
          col = this.resolveAnchorCol("center", width, availWidth, marginLeft);
        }
      } else {
        col = opt.col;
      }
    } else {
      const anchor = opt.anchor ?? "center";
      col = this.resolveAnchorCol(anchor, width, availWidth, marginLeft);
    }
    if (opt.offsetY !== void 0) row += opt.offsetY;
    if (opt.offsetX !== void 0) col += opt.offsetX;
    row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
    col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));
    return { width, row, col, maxHeight };
  }
  resolveAnchorRow(anchor, height, availHeight, marginTop) {
    switch (anchor) {
      case "top-left":
      case "top-center":
      case "top-right":
        return marginTop;
      case "bottom-left":
      case "bottom-center":
      case "bottom-right":
        return marginTop + availHeight - height;
      case "left-center":
      case "center":
      case "right-center":
        return marginTop + Math.floor((availHeight - height) / 2);
    }
  }
  resolveAnchorCol(anchor, width, availWidth, marginLeft) {
    switch (anchor) {
      case "top-left":
      case "left-center":
      case "bottom-left":
        return marginLeft;
      case "top-right":
      case "right-center":
      case "bottom-right":
        return marginLeft + availWidth - width;
      case "top-center":
      case "center":
      case "bottom-center":
        return marginLeft + Math.floor((availWidth - width) / 2);
    }
  }
  /** Composite all overlays into content lines (sorted by focusOrder, higher = on top). */
  compositeOverlays(lines, termWidth, termHeight) {
    if (this.overlayStack.length === 0) return lines;
    const result = [...lines];
    const rendered = [];
    let minLinesNeeded = result.length;
    const visibleEntries = this.overlayStack.filter((e) => this.isOverlayVisible(e));
    visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
    for (const entry of visibleEntries) {
      const { component, options } = entry;
      const { width, maxHeight } = this.resolveOverlayLayout(options, 0, termWidth, termHeight);
      let overlayLines = component.render(width);
      if (maxHeight !== void 0 && overlayLines.length > maxHeight) {
        overlayLines = overlayLines.slice(0, maxHeight);
      }
      const { row, col } = this.resolveOverlayLayout(options, overlayLines.length, termWidth, termHeight);
      rendered.push({ overlayLines, row, col, w: width });
      minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
    }
    const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);
    while (result.length < workingHeight) {
      result.push("");
    }
    const viewportStart = Math.max(0, workingHeight - termHeight);
    for (const { overlayLines, row, col, w } of rendered) {
      for (let i = 0; i < overlayLines.length; i++) {
        const idx = viewportStart + row + i;
        if (idx >= 0 && idx < result.length) {
          const truncatedOverlayLine = visibleWidth(overlayLines[i]) > w ? sliceByColumn(overlayLines[i], 0, w, true) : overlayLines[i];
          result[idx] = this.compositeLineAt(result[idx], truncatedOverlayLine, col, w, termWidth);
        }
      }
    }
    return result;
  }
  applyLineResets(lines) {
    const reset = SEGMENT_RESET;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isImageLine(line)) {
        lines[i] = normalizeTerminalOutput(line) + reset;
      }
    }
    return lines;
  }
  compositeLineAt(baseLine, overlayLine, startCol, overlayWidth, totalWidth) {
    return compositeTuiLine(baseLine, overlayLine, startCol, overlayWidth, totalWidth);
  }
  /**
   * Find and extract cursor position from rendered lines.
   * Searches for CURSOR_MARKER, calculates its position, and strips it from the output.
   * Only scans the bottom terminal height lines (visible viewport).
   * @param lines - Rendered lines to search
   * @param height - Terminal height (visible viewport size)
   * @returns Cursor position { row, col } or null if no marker found
   */
  extractCursorPosition(lines, height) {
    const viewportTop = Math.max(0, lines.length - height);
    for (let row = lines.length - 1; row >= viewportTop; row--) {
      const line = lines[row];
      const markerIndex = line.indexOf(CURSOR_MARKER);
      if (markerIndex !== -1) {
        const beforeMarker = line.slice(0, markerIndex);
        const col = visibleWidth(beforeMarker);
        lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
        return { row, col };
      }
    }
    return null;
  }
  /**
   * Query the terminal's default background color with OSC 11 (`ESC ] 11 ; ? BEL`).
   * @param timeoutMs Query timeout in milliseconds.
   * @returns Promise containing the parsed RGB color, or undefined if it times out or fails to parse.
   */
  queryTerminalBackgroundColor({ timeoutMs }) {
    return new Promise((resolve) => {
      const query = {
        settled: false,
        resolve,
        timer: void 0
      };
      query.timer = setTimeout(() => {
        if (query.settled) {
          return;
        }
        query.settled = true;
        query.timer = void 0;
        query.resolve?.(void 0);
        query.resolve = void 0;
      }, timeoutMs);
      this.pendingOsc11BackgroundQueries.push(query);
      this.pendingOsc11BackgroundReplies += 1;
      this.terminal.write("\x1B]11;?\x07");
    });
  }
  /**
   * Query the terminal's color-scheme preference with DSR (`CSI ? 996 n`).
   * Terminals that support the color palette notification protocol reply with
   * `CSI ? 997 ; 1 n` for dark or `CSI ? 997 ; 2 n` for light.
   */
  queryTerminalColorScheme({ timeoutMs }) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      let unsubscribe = () => {
      };
      const settle = (scheme) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = void 0;
        }
        unsubscribe();
        resolve(scheme);
      };
      unsubscribe = this.onTerminalColorSchemeChange(settle);
      timer = setTimeout(() => settle(void 0), timeoutMs);
      this.terminal.write("\x1B[?996n");
    });
  }
};

// tui/src/undo-stack.ts
var UndoStack = class {
  stack = [];
  /** Push a deep clone of the given state onto the stack. */
  push(state) {
    this.stack.push(structuredClone(state));
  }
  /** Pop and return the most recent snapshot, or undefined if empty. */
  pop() {
    return this.stack.pop();
  }
  /** Remove all snapshots. */
  clear() {
    this.stack.length = 0;
  }
  get length() {
    return this.stack.length;
  }
};

// tui/src/word-navigation.ts
var wordSegmenter2 = getWordSegmenter();
function findWordBackward(text, cursor, options) {
  if (cursor <= 0) return 0;
  const textBeforeCursor = text.slice(0, cursor);
  const segmentFn = options?.segment;
  const isAtomic = options?.isAtomicSegment;
  const segments = segmentFn ? [...segmentFn(textBeforeCursor)] : [...wordSegmenter2.segment(textBeforeCursor)];
  let newCursor = cursor;
  while (segments.length > 0 && !isAtomic?.(segments[segments.length - 1]?.segment || "") && isWhitespaceChar(segments[segments.length - 1]?.segment || "")) {
    newCursor -= segments.pop()?.segment.length || 0;
  }
  if (segments.length === 0) return newCursor;
  const last = segments[segments.length - 1];
  if (isAtomic?.(last.segment)) {
    newCursor -= last.segment.length;
  } else if (last.isWordLike) {
    const segment = last.segment;
    const matches = [...segment.matchAll(new RegExp(PUNCTUATION_REGEX, "g"))];
    if (matches.length <= 0) {
      newCursor -= segment.length;
    } else {
      const lastMatch = matches[matches.length - 1];
      newCursor -= segment.length - (lastMatch.index + lastMatch[0].length);
    }
  } else {
    while (segments.length > 0 && !isAtomic?.(segments[segments.length - 1]?.segment || "") && !segments[segments.length - 1]?.isWordLike && !isWhitespaceChar(segments[segments.length - 1]?.segment || "")) {
      newCursor -= segments.pop()?.segment.length || 0;
    }
  }
  return newCursor;
}
function findWordForward(text, cursor, options) {
  if (cursor >= text.length) return text.length;
  const textAfterCursor = text.slice(cursor);
  const segmentFn = options?.segment;
  const isAtomic = options?.isAtomicSegment;
  const segments = segmentFn ? segmentFn(textAfterCursor) : wordSegmenter2.segment(textAfterCursor);
  const iterator = segments[Symbol.iterator]();
  let next = iterator.next();
  let newCursor = cursor;
  while (!next.done && !isAtomic?.(next.value.segment) && isWhitespaceChar(next.value.segment)) {
    newCursor += next.value.segment.length;
    next = iterator.next();
  }
  if (next.done) return newCursor;
  if (isAtomic?.(next.value.segment)) {
    newCursor += next.value.segment.length;
  } else if (next.value.isWordLike) {
    newCursor += PUNCTUATION_REGEX.exec(next.value.segment)?.index ?? next.value.segment.length;
  } else {
    while (!next.done && !isAtomic?.(next.value.segment) && !next.value.isWordLike && !isWhitespaceChar(next.value.segment)) {
      newCursor += next.value.segment.length;
      next = iterator.next();
    }
  }
  return newCursor;
}

// tui/src/components/select-list.ts
var DEFAULT_PRIMARY_COLUMN_WIDTH = 32;
var PRIMARY_COLUMN_GAP = 2;
var MIN_DESCRIPTION_WIDTH = 10;
var normalizeToSingleLine = (text) => text.replace(/[\r\n]+/g, " ").trim();
var clamp = (value, min, max) => Math.max(min, Math.min(value, max));
var SelectList = class {
  items = [];
  filteredItems = [];
  selectedIndex = 0;
  maxVisible = 5;
  theme;
  layout;
  onSelect;
  onCancel;
  onSelectionChange;
  constructor(items, maxVisible, theme, layout = {}) {
    this.items = items;
    this.filteredItems = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.layout = layout;
  }
  setFilter(filter) {
    this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(filter.toLowerCase()));
    this.selectedIndex = 0;
  }
  setSelectedIndex(index) {
    this.selectedIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));
  }
  invalidate() {
  }
  render(width) {
    const lines = [];
    if (this.filteredItems.length === 0) {
      lines.push(this.theme.noMatch("  No matching commands"));
      return lines;
    }
    const primaryColumnWidth = this.getPrimaryColumnWidth();
    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible)
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;
      const isSelected = i === this.selectedIndex;
      const descriptionSingleLine = item.description ? normalizeToSingleLine(item.description) : void 0;
      lines.push(this.renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth));
    }
    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      const scrollText = `  (${this.selectedIndex + 1}/${this.filteredItems.length})`;
      lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, width - 2, "")));
    }
    return lines;
  }
  handleInput(keyData) {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
      this.notifySelectionChange();
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
      this.notifySelectionChange();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selectedItem = this.filteredItems[this.selectedIndex];
      if (selectedItem && this.onSelect) {
        this.onSelect(selectedItem);
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      if (this.onCancel) {
        this.onCancel();
      }
    }
  }
  renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth) {
    const prefix = isSelected ? "\u2192 " : "  ";
    const prefixWidth = visibleWidth(prefix);
    if (descriptionSingleLine && width > 40) {
      const effectivePrimaryColumnWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4));
      const maxPrimaryWidth = Math.max(1, effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP);
      const truncatedValue2 = this.truncatePrimary(item, isSelected, maxPrimaryWidth, effectivePrimaryColumnWidth);
      const truncatedValueWidth = visibleWidth(truncatedValue2);
      const spacing = " ".repeat(Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth));
      const descriptionStart = prefixWidth + truncatedValueWidth + spacing.length;
      const remainingWidth = width - descriptionStart - 2;
      if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
        const truncatedDesc = truncateToWidth(descriptionSingleLine, remainingWidth, "");
        if (isSelected) {
          return this.theme.selectedText(`${prefix}${truncatedValue2}${spacing}${truncatedDesc}`);
        }
        const descText = this.theme.description(spacing + truncatedDesc);
        return prefix + truncatedValue2 + descText;
      }
    }
    const maxWidth = width - prefixWidth - 2;
    const truncatedValue = this.truncatePrimary(item, isSelected, maxWidth, maxWidth);
    if (isSelected) {
      return this.theme.selectedText(`${prefix}${truncatedValue}`);
    }
    return prefix + truncatedValue;
  }
  getPrimaryColumnWidth() {
    const { min, max } = this.getPrimaryColumnBounds();
    const widestPrimary = this.filteredItems.reduce((widest, item) => {
      return Math.max(widest, visibleWidth(this.getDisplayValue(item)) + PRIMARY_COLUMN_GAP);
    }, 0);
    return clamp(widestPrimary, min, max);
  }
  getPrimaryColumnBounds() {
    const rawMin = this.layout.minPrimaryColumnWidth ?? this.layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
    const rawMax = this.layout.maxPrimaryColumnWidth ?? this.layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
    return {
      min: Math.max(1, Math.min(rawMin, rawMax)),
      max: Math.max(1, Math.max(rawMin, rawMax))
    };
  }
  truncatePrimary(item, isSelected, maxWidth, columnWidth) {
    const displayValue = this.getDisplayValue(item);
    const truncatedValue = this.layout.truncatePrimary ? this.layout.truncatePrimary({
      text: displayValue,
      maxWidth,
      columnWidth,
      item,
      isSelected
    }) : truncateToWidth(displayValue, maxWidth, "");
    return truncateToWidth(truncatedValue, maxWidth, "");
  }
  getDisplayValue(item) {
    return item.label || item.value;
  }
  notifySelectionChange() {
    const selectedItem = this.filteredItems[this.selectedIndex];
    if (selectedItem && this.onSelectionChange) {
      this.onSelectionChange(selectedItem);
    }
  }
  getSelectedItem() {
    const item = this.filteredItems[this.selectedIndex];
    return item || null;
  }
};

// tui/src/components/editor.ts
var graphemeSegmenter2 = getGraphemeSegmenter();
var wordSegmenter3 = getWordSegmenter();
var PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
var PASTE_MARKER_SINGLE = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/;
function isPasteMarker(segment) {
  return segment.length >= 10 && PASTE_MARKER_SINGLE.test(segment);
}
function segmentWithMarkers(text, baseSegmenter, validIds) {
  if (validIds.size === 0 || !text.includes("[paste #")) {
    return baseSegmenter.segment(text);
  }
  const markers = [];
  for (const m of text.matchAll(PASTE_MARKER_REGEX)) {
    const id = Number.parseInt(m[1], 10);
    if (!validIds.has(id)) continue;
    markers.push({ start: m.index, end: m.index + m[0].length });
  }
  if (markers.length === 0) {
    return baseSegmenter.segment(text);
  }
  const baseSegments = baseSegmenter.segment(text);
  const result = [];
  let markerIdx = 0;
  for (const seg of baseSegments) {
    while (markerIdx < markers.length && markers[markerIdx].end <= seg.index) {
      markerIdx++;
    }
    const marker = markerIdx < markers.length ? markers[markerIdx] : null;
    if (marker && seg.index >= marker.start && seg.index < marker.end) {
      if (seg.index === marker.start) {
        const markerText = text.slice(marker.start, marker.end);
        result.push({
          segment: markerText,
          index: marker.start,
          input: text
        });
      }
    } else {
      result.push(seg);
    }
  }
  return result;
}
function wordWrapLine(line, maxWidth, preSegmented) {
  if (!line || maxWidth <= 0) {
    return [{ text: "", startIndex: 0, endIndex: 0 }];
  }
  const lineWidth = visibleWidth(line);
  if (lineWidth <= maxWidth) {
    return [{ text: line, startIndex: 0, endIndex: line.length }];
  }
  const chunks = [];
  const segments = preSegmented ?? [...graphemeSegmenter2.segment(line)];
  let currentWidth = 0;
  let chunkStart = 0;
  let wrapOppIndex = -1;
  let wrapOppWidth = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const grapheme = seg.segment;
    const gWidth = visibleWidth(grapheme);
    const charIndex = seg.index;
    const isWs = !isPasteMarker(grapheme) && isWhitespaceChar(grapheme);
    if (currentWidth + gWidth > maxWidth) {
      if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + gWidth <= maxWidth) {
        chunks.push({ text: line.slice(chunkStart, wrapOppIndex), startIndex: chunkStart, endIndex: wrapOppIndex });
        chunkStart = wrapOppIndex;
        currentWidth -= wrapOppWidth;
      } else if (chunkStart < charIndex) {
        chunks.push({ text: line.slice(chunkStart, charIndex), startIndex: chunkStart, endIndex: charIndex });
        chunkStart = charIndex;
        currentWidth = 0;
      }
      wrapOppIndex = -1;
    }
    if (gWidth > maxWidth) {
      const subChunks = wordWrapLine(grapheme, maxWidth);
      for (let j = 0; j < subChunks.length - 1; j++) {
        const sc = subChunks[j];
        chunks.push({ text: sc.text, startIndex: charIndex + sc.startIndex, endIndex: charIndex + sc.endIndex });
      }
      const last = subChunks[subChunks.length - 1];
      chunkStart = charIndex + last.startIndex;
      currentWidth = visibleWidth(last.text);
      wrapOppIndex = -1;
      continue;
    }
    currentWidth += gWidth;
    const next = segments[i + 1];
    if (isWs && next && (isPasteMarker(next.segment) || !isWhitespaceChar(next.segment))) {
      wrapOppIndex = next.index;
      wrapOppWidth = currentWidth;
    } else if (!isWs && next && !isWhitespaceChar(next.segment)) {
      const isCjk = !isPasteMarker(grapheme) && cjkBreakRegex.test(grapheme);
      const nextIsCjk = !isPasteMarker(next.segment) && cjkBreakRegex.test(next.segment);
      if (isCjk || nextIsCjk) {
        wrapOppIndex = next.index;
        wrapOppWidth = currentWidth;
      }
    }
  }
  chunks.push({ text: line.slice(chunkStart), startIndex: chunkStart, endIndex: line.length });
  return chunks;
}
var SLASH_COMMAND_SELECT_LIST_LAYOUT = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32
};
var ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS = 20;
var DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS = ["@", "#"];
function escapeCharacterClass(value) {
  return value.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
}
function buildTriggerPattern(triggerCharacters) {
  return new RegExp(`(?:^|[\\s])[${triggerCharacters.map(escapeCharacterClass).join("")}][^\\s]*$`);
}
function buildDebouncePattern(triggerCharacters) {
  const escapedWithoutAt = triggerCharacters.filter((character) => character !== "@").map(escapeCharacterClass);
  return new RegExp(`(?:^|[ \\t])(?:@(?:"[^"]*|[^\\s]*)|[${escapedWithoutAt.join("")}][^\\s]*)$`);
}
function createScrollBorder(direction, hiddenLineCount, width) {
  const availableWidth = Math.max(0, width);
  const indicator = `\u2500\u2500\u2500 ${direction} ${hiddenLineCount} more `;
  const remaining = availableWidth - visibleWidth(indicator);
  if (remaining >= 0) return indicator + "\u2500".repeat(remaining);
  const ellipsis = "...".slice(0, availableWidth);
  const indicatorWidth = availableWidth - visibleWidth(ellipsis);
  return sliceByColumn(indicator, 0, indicatorWidth, true) + ellipsis;
}
var Editor = class {
  state = {
    lines: [""],
    cursorLine: 0,
    cursorCol: 0
  };
  /** Focusable interface - set by TUI when focus changes */
  focused = false;
  tui;
  theme;
  paddingX = 0;
  // Store last render width for cursor navigation
  lastWidth = 80;
  // Vertical scrolling support
  scrollOffset = 0;
  // Border color (can be changed dynamically)
  borderColor;
  // Autocomplete support
  autocompleteProvider;
  autocompleteTriggerCharacters = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
  autocompleteTriggerPattern = buildTriggerPattern(this.autocompleteTriggerCharacters);
  autocompleteDebouncePattern = buildDebouncePattern(this.autocompleteTriggerCharacters);
  autocompleteList;
  autocompleteState = null;
  autocompletePrefix = "";
  autocompleteMaxVisible = 5;
  autocompleteAbort;
  autocompleteDebounceTimer;
  autocompleteRequestTask = Promise.resolve();
  autocompleteStartToken = 0;
  autocompleteRequestId = 0;
  // Paste tracking for large pastes
  pastes = /* @__PURE__ */ new Map();
  pasteCounter = 0;
  // Bracketed paste mode buffering
  pasteBuffer = "";
  isInPaste = false;
  // Prompt history for up/down navigation
  history = [];
  historyIndex = -1;
  // -1 = not browsing, 0 = most recent, 1 = older, etc.
  historyDraft = null;
  // Kill ring for Emacs-style kill/yank operations
  killRing = new KillRing();
  lastAction = null;
  // Character jump mode
  jumpMode = null;
  // Preferred visual column for vertical cursor movement (sticky column)
  preferredVisualCol = null;
  // When the cursor is snapped to the start of an atomic segment, e.g. a
  // paste marker, cursorCol no longer reflects where the cursor would have
  // landed. This field stores the pre-snap cursorCol so that the next
  // vertical move can resolve it to a visual column on whatever VL it belongs
  // to.
  snappedFromCursorCol = null;
  // Undo support
  undoStack = new UndoStack();
  onSubmit;
  onChange;
  disableSubmit = false;
  constructor(tui, theme, options = {}) {
    this.tui = tui;
    this.theme = theme;
    this.borderColor = theme.borderColor;
    const paddingX = options.paddingX ?? 0;
    this.paddingX = Number.isFinite(paddingX) ? Math.max(0, Math.floor(paddingX)) : 0;
    const maxVisible = options.autocompleteMaxVisible ?? 5;
    this.autocompleteMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
  }
  /** Set of currently valid paste IDs, for marker-aware segmentation. */
  validPasteIds() {
    return new Set(this.pastes.keys());
  }
  /** Segment text with paste-marker awareness, only merging markers with valid IDs. */
  segment(text, mode) {
    return segmentWithMarkers(text, mode === "word" ? wordSegmenter3 : graphemeSegmenter2, this.validPasteIds());
  }
  getPaddingX() {
    return this.paddingX;
  }
  setPaddingX(padding) {
    const newPadding = Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0;
    if (this.paddingX !== newPadding) {
      this.paddingX = newPadding;
      this.tui.requestRender();
    }
  }
  getAutocompleteMaxVisible() {
    return this.autocompleteMaxVisible;
  }
  setAutocompleteMaxVisible(maxVisible) {
    const newMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
    if (this.autocompleteMaxVisible !== newMaxVisible) {
      this.autocompleteMaxVisible = newMaxVisible;
      this.tui.requestRender();
    }
  }
  setAutocompleteProvider(provider) {
    this.cancelAutocomplete();
    this.autocompleteProvider = provider;
    this.setAutocompleteTriggerCharacters(provider.triggerCharacters ?? []);
  }
  /**
   * Add a prompt to history for up/down arrow navigation.
   * Called after successful submission.
   */
  addToHistory(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.history.length > 0 && this.history[0] === trimmed) return;
    this.history.unshift(trimmed);
    if (this.history.length > 100) {
      this.history.pop();
    }
  }
  isEditorEmpty() {
    return this.state.lines.length === 1 && this.state.lines[0] === "";
  }
  isOnFirstVisualLine() {
    const visualLines = this.buildVisualLineMap(this.lastWidth);
    const currentVisualLine = this.findCurrentVisualLine(visualLines);
    return currentVisualLine === 0;
  }
  isOnLastVisualLine() {
    const visualLines = this.buildVisualLineMap(this.lastWidth);
    const currentVisualLine = this.findCurrentVisualLine(visualLines);
    return currentVisualLine === visualLines.length - 1;
  }
  navigateHistory(direction) {
    this.lastAction = null;
    if (this.history.length === 0) return;
    const newIndex = this.historyIndex - direction;
    if (newIndex < -1 || newIndex >= this.history.length) return;
    if (this.historyIndex === -1 && newIndex >= 0) {
      this.pushUndoSnapshot();
      this.historyDraft = structuredClone(this.state);
    }
    this.historyIndex = newIndex;
    if (this.historyIndex === -1) {
      const draft = this.historyDraft;
      this.historyDraft = null;
      if (draft) {
        this.state = draft;
        this.preferredVisualCol = null;
        this.snappedFromCursorCol = null;
        this.scrollOffset = 0;
        if (this.onChange) this.onChange(this.getText());
      } else {
        this.setTextInternal("");
      }
    } else {
      this.setTextInternal(this.history[this.historyIndex] || "", direction === -1 ? "start" : "end");
    }
  }
  exitHistoryBrowsing() {
    this.historyIndex = -1;
    this.historyDraft = null;
  }
  /** Internal setText that doesn't reset history state - used by navigateHistory */
  setTextInternal(text, cursorPlacement = "end") {
    const lines = text.split("\n");
    this.state.lines = lines.length === 0 ? [""] : lines;
    this.state.cursorLine = cursorPlacement === "start" ? 0 : this.state.lines.length - 1;
    this.setCursorCol(cursorPlacement === "start" ? 0 : this.state.lines[this.state.cursorLine]?.length || 0);
    this.scrollOffset = 0;
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  invalidate() {
  }
  render(width) {
    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min(this.paddingX, maxPadding);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    this.lastWidth = layoutWidth;
    const horizontal = this.borderColor("\u2500");
    const layoutLines = this.layoutText(layoutWidth);
    const terminalRows = this.tui.terminal.rows;
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
    let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
    if (cursorLineIndex === -1) cursorLineIndex = 0;
    if (cursorLineIndex < this.scrollOffset) {
      this.scrollOffset = cursorLineIndex;
    } else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) {
      this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
    }
    const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));
    const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);
    const result = [];
    const leftPadding = " ".repeat(paddingX);
    const rightPadding = leftPadding;
    if (this.scrollOffset > 0) {
      const border = createScrollBorder("\u2191", this.scrollOffset, width);
      result.push(this.borderColor(border));
    } else {
      result.push(horizontal.repeat(width));
    }
    const emitCursorMarker = this.focused;
    for (const layoutLine of visibleLines) {
      let displayText = layoutLine.text;
      let lineVisibleWidth = visibleWidth(layoutLine.text);
      let cursorInPadding = false;
      if (layoutLine.hasCursor && layoutLine.cursorPos !== void 0) {
        const before = displayText.slice(0, layoutLine.cursorPos);
        const after = displayText.slice(layoutLine.cursorPos);
        const marker = emitCursorMarker ? CURSOR_MARKER : "";
        if (after.length > 0) {
          const afterGraphemes = [...this.segment(after, "grapheme")];
          const firstGrapheme = afterGraphemes[0]?.segment || "";
          const restAfter = after.slice(firstGrapheme.length);
          const cursor = `\x1B[7m${firstGrapheme}\x1B[0m`;
          displayText = before + marker + cursor + restAfter;
        } else {
          const cursor = "\x1B[7m \x1B[0m";
          displayText = before + marker + cursor;
          lineVisibleWidth = lineVisibleWidth + 1;
          if (lineVisibleWidth > contentWidth && paddingX > 0) {
            cursorInPadding = true;
          }
        }
      }
      const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));
      const lineRightPadding = cursorInPadding ? rightPadding.slice(1) : rightPadding;
      result.push(`${leftPadding}${displayText}${padding}${lineRightPadding}`);
    }
    const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
    if (linesBelow > 0) {
      const border = createScrollBorder("\u2193", linesBelow, width);
      result.push(this.borderColor(border));
    } else {
      result.push(horizontal.repeat(width));
    }
    if (this.autocompleteState && this.autocompleteList) {
      const autocompleteResult = this.autocompleteList.render(contentWidth);
      for (const line of autocompleteResult) {
        const lineWidth = visibleWidth(line);
        const linePadding = " ".repeat(Math.max(0, contentWidth - lineWidth));
        result.push(`${leftPadding}${line}${linePadding}${rightPadding}`);
      }
    }
    return result;
  }
  handleInput(data) {
    const kb = getKeybindings();
    if (this.jumpMode !== null) {
      if (kb.matches(data, "tui.editor.jumpForward") || kb.matches(data, "tui.editor.jumpBackward")) {
        this.jumpMode = null;
        return;
      }
      const printable2 = decodePrintableKey(data) ?? (data.charCodeAt(0) >= 32 ? data : void 0);
      if (printable2 !== void 0) {
        const direction = this.jumpMode;
        this.jumpMode = null;
        this.jumpToChar(printable2, direction);
        return;
      }
      this.jumpMode = null;
    }
    if (data.includes("\x1B[200~")) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      data = data.replace("\x1B[200~", "");
    }
    if (this.isInPaste) {
      this.pasteBuffer += data;
      const endIndex = this.pasteBuffer.indexOf("\x1B[201~");
      if (endIndex !== -1) {
        const pasteContent = this.pasteBuffer.substring(0, endIndex);
        if (pasteContent.length > 0) {
          this.handlePaste(pasteContent);
        }
        this.isInPaste = false;
        const remaining = this.pasteBuffer.substring(endIndex + 6);
        this.pasteBuffer = "";
        if (remaining.length > 0) {
          this.handleInput(remaining);
        }
        return;
      }
      return;
    }
    if (kb.matches(data, "tui.input.copy")) {
      return;
    }
    if (kb.matches(data, "tui.editor.undo")) {
      this.undo();
      return;
    }
    if (this.autocompleteState && this.autocompleteList) {
      if (kb.matches(data, "tui.select.cancel")) {
        this.cancelAutocomplete();
        return;
      }
      if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
        this.autocompleteList.handleInput(data);
        return;
      }
      if (kb.matches(data, "tui.input.tab")) {
        const selected = this.autocompleteList.getSelectedItem();
        if (selected && this.autocompleteProvider) {
          this.pushUndoSnapshot();
          this.lastAction = null;
          const result = this.autocompleteProvider.applyCompletion(
            this.state.lines,
            this.state.cursorLine,
            this.state.cursorCol,
            selected,
            this.autocompletePrefix
          );
          this.state.lines = result.lines;
          this.state.cursorLine = result.cursorLine;
          this.setCursorCol(result.cursorCol);
          this.cancelAutocomplete();
          if (this.onChange) this.onChange(this.getText());
        }
        return;
      }
      if (kb.matches(data, "tui.select.confirm")) {
        const selected = this.autocompleteList.getSelectedItem();
        if (selected && this.autocompleteProvider) {
          this.pushUndoSnapshot();
          this.lastAction = null;
          const result = this.autocompleteProvider.applyCompletion(
            this.state.lines,
            this.state.cursorLine,
            this.state.cursorCol,
            selected,
            this.autocompletePrefix
          );
          this.state.lines = result.lines;
          this.state.cursorLine = result.cursorLine;
          this.setCursorCol(result.cursorCol);
          if (this.autocompletePrefix.startsWith("/")) {
            this.cancelAutocomplete();
          } else {
            this.cancelAutocomplete();
            if (this.onChange) this.onChange(this.getText());
            return;
          }
        }
      }
    }
    if (kb.matches(data, "tui.input.tab") && !this.autocompleteState) {
      this.handleTabCompletion();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
      this.deleteToEndOfLine();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteToLineStart")) {
      this.deleteToStartOfLine();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteWordBackward")) {
      this.deleteWordBackwards();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteWordForward")) {
      this.deleteWordForward();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace")) {
      this.handleBackspace();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteCharForward") || matchesKey(data, "shift+delete")) {
      this.handleForwardDelete();
      return;
    }
    if (kb.matches(data, "tui.editor.yank")) {
      this.yank();
      return;
    }
    if (kb.matches(data, "tui.editor.yankPop")) {
      this.yankPop();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLineStart")) {
      this.moveToLineStart();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLineEnd")) {
      this.moveToLineEnd();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorWordLeft")) {
      this.moveWordBackwards();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorWordRight")) {
      this.moveWordForwards();
      return;
    }
    if (kb.matches(data, "tui.input.newLine") || data.charCodeAt(0) === 10 && data.length > 1 || data === "\x1B\r" || data === "\x1B[13;2~" || data.length > 1 && data.includes("\x1B") && data.includes("\r") || data === "\n" && data.length === 1) {
      if (this.shouldSubmitOnBackslashEnter(data, kb)) {
        this.handleBackspace();
        this.submitValue();
        return;
      }
      this.addNewLine();
      return;
    }
    if (kb.matches(data, "tui.input.submit")) {
      if (this.disableSubmit) return;
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      if (this.state.cursorCol > 0 && currentLine[this.state.cursorCol - 1] === "\\") {
        this.handleBackspace();
        this.addNewLine();
        return;
      }
      this.submitValue();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorUp")) {
      if (this.isOnFirstVisualLine() && (this.isEditorEmpty() || this.historyIndex > -1 || this.state.cursorCol === 0)) {
        this.navigateHistory(-1);
      } else if (this.isOnFirstVisualLine()) {
        this.moveToLineStart();
      } else {
        this.moveCursor(-1, 0);
      }
      return;
    }
    if (kb.matches(data, "tui.editor.cursorDown")) {
      if (this.historyIndex > -1 && this.isOnLastVisualLine()) {
        this.navigateHistory(1);
      } else if (this.isOnLastVisualLine()) {
        this.moveToLineEnd();
      } else {
        this.moveCursor(1, 0);
      }
      return;
    }
    if (kb.matches(data, "tui.editor.cursorRight")) {
      this.moveCursor(0, 1);
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLeft")) {
      this.moveCursor(0, -1);
      return;
    }
    if (kb.matches(data, "tui.editor.pageUp")) {
      this.pageScroll(-1);
      return;
    }
    if (kb.matches(data, "tui.editor.pageDown")) {
      this.pageScroll(1);
      return;
    }
    if (kb.matches(data, "tui.editor.jumpForward")) {
      this.jumpMode = "forward";
      return;
    }
    if (kb.matches(data, "tui.editor.jumpBackward")) {
      this.jumpMode = "backward";
      return;
    }
    if (matchesKey(data, "shift+space")) {
      this.insertCharacter(" ");
      return;
    }
    const printable = decodePrintableKey(data);
    if (printable !== void 0) {
      this.insertCharacter(printable);
      return;
    }
    if (data.charCodeAt(0) >= 32) {
      this.insertCharacter(data);
    }
  }
  layoutText(contentWidth) {
    const layoutLines = [];
    if (this.state.lines.length === 0 || this.state.lines.length === 1 && this.state.lines[0] === "") {
      layoutLines.push({
        text: "",
        hasCursor: true,
        cursorPos: 0
      });
      return layoutLines;
    }
    for (let i = 0; i < this.state.lines.length; i++) {
      const line = this.state.lines[i] || "";
      const isCurrentLine = i === this.state.cursorLine;
      const lineVisibleWidth = visibleWidth(line);
      if (lineVisibleWidth <= contentWidth) {
        if (isCurrentLine) {
          layoutLines.push({
            text: line,
            hasCursor: true,
            cursorPos: this.state.cursorCol
          });
        } else {
          layoutLines.push({
            text: line,
            hasCursor: false
          });
        }
      } else {
        const chunks = wordWrapLine(line, contentWidth, [...this.segment(line, "grapheme")]);
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          if (!chunk) continue;
          const cursorPos = this.state.cursorCol;
          const isLastChunk = chunkIndex === chunks.length - 1;
          let hasCursorInChunk = false;
          let adjustedCursorPos = 0;
          if (isCurrentLine) {
            if (isLastChunk) {
              hasCursorInChunk = cursorPos >= chunk.startIndex;
              adjustedCursorPos = cursorPos - chunk.startIndex;
            } else {
              hasCursorInChunk = cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
              if (hasCursorInChunk) {
                adjustedCursorPos = cursorPos - chunk.startIndex;
                if (adjustedCursorPos > chunk.text.length) {
                  adjustedCursorPos = chunk.text.length;
                }
              }
            }
          }
          if (hasCursorInChunk) {
            layoutLines.push({
              text: chunk.text,
              hasCursor: true,
              cursorPos: adjustedCursorPos
            });
          } else {
            layoutLines.push({
              text: chunk.text,
              hasCursor: false
            });
          }
        }
      }
    }
    return layoutLines;
  }
  getText() {
    return this.state.lines.join("\n");
  }
  expandPasteMarkers(text) {
    let result = text;
    for (const [pasteId, pasteContent] of this.pastes) {
      const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
      result = result.replace(markerRegex, () => pasteContent);
    }
    return result;
  }
  /**
   * Get text with paste markers expanded to their actual content.
   * Use this when you need the full content (e.g., for external editor).
   */
  getExpandedText() {
    return this.expandPasteMarkers(this.state.lines.join("\n"));
  }
  getLines() {
    return [...this.state.lines];
  }
  getCursor() {
    return { line: this.state.cursorLine, col: this.state.cursorCol };
  }
  setText(text) {
    this.cancelAutocomplete();
    this.lastAction = null;
    this.exitHistoryBrowsing();
    const normalized = this.normalizeText(text);
    if (this.getText() !== normalized) {
      this.pushUndoSnapshot();
    }
    this.pastes.clear();
    this.pasteCounter = 0;
    this.setTextInternal(normalized);
  }
  /**
   * Insert text at the current cursor position.
   * Used for programmatic insertion (e.g., clipboard image markers).
   * This is atomic for undo - single undo restores entire pre-insert state.
   */
  insertTextAtCursor(text) {
    if (!text) return;
    this.cancelAutocomplete();
    this.pushUndoSnapshot();
    this.lastAction = null;
    this.exitHistoryBrowsing();
    this.insertTextAtCursorInternal(text);
  }
  /**
   * Normalize text for editor storage:
   * - Normalize line endings (\r\n and \r -> \n)
   * - Expand tabs to 4 spaces
   */
  normalizeText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
  }
  /**
   * Internal text insertion at cursor. Handles single and multi-line text.
   * Does not push undo snapshots or trigger autocomplete - caller is responsible.
   * Normalizes line endings and calls onChange once at the end.
   */
  insertTextAtCursorInternal(text) {
    if (!text) return;
    const normalized = this.normalizeText(text);
    const insertedLines = normalized.split("\n");
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    const beforeCursor = currentLine.slice(0, this.state.cursorCol);
    const afterCursor = currentLine.slice(this.state.cursorCol);
    if (insertedLines.length === 1) {
      this.state.lines[this.state.cursorLine] = beforeCursor + normalized + afterCursor;
      this.setCursorCol(this.state.cursorCol + normalized.length);
    } else {
      this.state.lines = [
        // All lines before current line
        ...this.state.lines.slice(0, this.state.cursorLine),
        // The first inserted line merged with text before cursor
        beforeCursor + insertedLines[0],
        // All middle inserted lines
        ...insertedLines.slice(1, -1),
        // The last inserted line with text after cursor
        insertedLines[insertedLines.length - 1] + afterCursor,
        // All lines after current line
        ...this.state.lines.slice(this.state.cursorLine + 1)
      ];
      this.state.cursorLine += insertedLines.length - 1;
      this.setCursorCol((insertedLines[insertedLines.length - 1] || "").length);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  // All the editor methods from before...
  insertCharacter(char, skipUndoCoalescing) {
    this.exitHistoryBrowsing();
    if (!skipUndoCoalescing) {
      if (isWhitespaceChar(char) || this.lastAction !== "type-word") {
        this.pushUndoSnapshot();
      }
      this.lastAction = "type-word";
    }
    const line = this.state.lines[this.state.cursorLine] || "";
    const before = line.slice(0, this.state.cursorCol);
    const after = line.slice(this.state.cursorCol);
    this.state.lines[this.state.cursorLine] = before + char + after;
    this.setCursorCol(this.state.cursorCol + char.length);
    if (this.onChange) {
      this.onChange(this.getText());
    }
    if (!this.autocompleteState) {
      if (char === "/" && this.isAtStartOfMessage()) {
        this.tryTriggerAutocomplete();
      } else if (this.autocompleteTriggerCharacters.includes(char)) {
        const currentLine = this.state.lines[this.state.cursorLine] || "";
        const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
        const charBeforeSymbol = textBeforeCursor[textBeforeCursor.length - 2];
        if (textBeforeCursor.length === 1 || charBeforeSymbol === " " || charBeforeSymbol === "	") {
          this.tryTriggerAutocomplete();
        }
      } else if (/[a-zA-Z0-9.\-_]/.test(char)) {
        const currentLine = this.state.lines[this.state.cursorLine] || "";
        const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
        if (this.isInSlashCommandContext(textBeforeCursor)) {
          this.tryTriggerAutocomplete();
        } else if (this.autocompleteTriggerPattern.test(textBeforeCursor)) {
          this.tryTriggerAutocomplete();
        }
      }
    } else {
      this.updateAutocomplete();
    }
  }
  handlePaste(pastedText) {
    this.cancelAutocomplete();
    this.exitHistoryBrowsing();
    this.lastAction = null;
    this.pushUndoSnapshot();
    const decodedText = pastedText.replace(/\x1b\[(\d+);5u/g, (match, code) => {
      const cp = Number(code);
      if (cp >= 97 && cp <= 122) return String.fromCharCode(cp - 96);
      if (cp >= 65 && cp <= 90) return String.fromCharCode(cp - 64);
      return match;
    });
    const cleanText = this.normalizeText(decodedText);
    let filteredText = cleanText.split("").filter((char) => char === "\n" || char.charCodeAt(0) >= 32).join("");
    if (/^[/~.]/.test(filteredText)) {
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      const charBeforeCursor = this.state.cursorCol > 0 ? currentLine[this.state.cursorCol - 1] : "";
      if (charBeforeCursor && /\w/.test(charBeforeCursor)) {
        filteredText = ` ${filteredText}`;
      }
    }
    const pastedLines = filteredText.split("\n");
    const totalChars = filteredText.length;
    if (pastedLines.length > 10 || totalChars > 1e3) {
      this.pasteCounter++;
      const pasteId = this.pasteCounter;
      this.pastes.set(pasteId, filteredText);
      const marker = pastedLines.length > 10 ? `[paste #${pasteId} +${pastedLines.length} lines]` : `[paste #${pasteId} ${totalChars} chars]`;
      this.insertTextAtCursorInternal(marker);
      return;
    }
    if (pastedLines.length === 1) {
      this.insertTextAtCursorInternal(filteredText);
      return;
    }
    this.insertTextAtCursorInternal(filteredText);
  }
  addNewLine() {
    this.cancelAutocomplete();
    this.exitHistoryBrowsing();
    this.lastAction = null;
    this.pushUndoSnapshot();
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    const before = currentLine.slice(0, this.state.cursorCol);
    const after = currentLine.slice(this.state.cursorCol);
    this.state.lines[this.state.cursorLine] = before;
    this.state.lines.splice(this.state.cursorLine + 1, 0, after);
    this.state.cursorLine++;
    this.setCursorCol(0);
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  shouldSubmitOnBackslashEnter(data, kb) {
    if (this.disableSubmit) return false;
    if (!matchesKey(data, "enter")) return false;
    const submitKeys = kb.getKeys("tui.input.submit");
    const hasShiftEnter = submitKeys.includes("shift+enter") || submitKeys.includes("shift+return");
    if (!hasShiftEnter) return false;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    return this.state.cursorCol > 0 && currentLine[this.state.cursorCol - 1] === "\\";
  }
  submitValue() {
    this.cancelAutocomplete();
    const result = this.expandPasteMarkers(this.state.lines.join("\n")).trim();
    this.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
    this.pastes.clear();
    this.pasteCounter = 0;
    this.exitHistoryBrowsing();
    this.scrollOffset = 0;
    this.undoStack.clear();
    this.lastAction = null;
    if (this.onChange) this.onChange("");
    if (this.onSubmit) this.onSubmit(result);
  }
  handleBackspace() {
    this.exitHistoryBrowsing();
    this.lastAction = null;
    if (this.state.cursorCol > 0) {
      this.pushUndoSnapshot();
      let line = this.state.lines[this.state.cursorLine] || "";
      const beforeCursor = line.slice(0, this.state.cursorCol);
      const graphemes = [...this.segment(beforeCursor, "grapheme")];
      const lastGrapheme = graphemes[graphemes.length - 1];
      const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
      const isPastedSegmented = PASTE_MARKER_SINGLE.exec(lastGrapheme.segment);
      if (isPastedSegmented) {
        const targetId = Number(isPastedSegmented[1]);
        this.pastes.delete(targetId);
        this.pasteCounter--;
        const higherIds = [...this.pastes.keys()].filter((id) => id > targetId).sort((a, b) => a - b);
        for (const id of higherIds) {
          this.pastes.set(id - 1, this.pastes.get(id));
          this.pastes.delete(id);
        }
        this.state.lines = this.state.lines.map(
          (line2) => line2.replace(PASTE_MARKER_REGEX, (fullMatch, idGroup, suffixGroup) => {
            const x = Number(idGroup);
            if (x <= targetId) return fullMatch;
            return `[paste #${x - 1}${suffixGroup}]`;
          })
        );
      }
      line = this.state.lines[this.state.cursorLine] || "";
      const before = line.slice(0, this.state.cursorCol - graphemeLength);
      const after = line.slice(this.state.cursorCol);
      this.state.lines[this.state.cursorLine] = before + after;
      this.setCursorCol(this.state.cursorCol - graphemeLength);
    } else if (this.state.cursorLine > 0) {
      this.pushUndoSnapshot();
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
      this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
      this.state.lines.splice(this.state.cursorLine, 1);
      this.state.cursorLine--;
      this.setCursorCol(previousLine.length);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
    if (this.autocompleteState) {
      this.updateAutocomplete();
    } else {
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
      if (this.isInSlashCommandContext(textBeforeCursor)) {
        this.tryTriggerAutocomplete();
      } else if (this.autocompleteTriggerPattern.test(textBeforeCursor)) {
        this.tryTriggerAutocomplete();
      }
    }
  }
  /**
   * Set cursor column and clear preferredVisualCol.
   * Use this for all non-vertical cursor movements to reset sticky column behavior.
   */
  setCursorCol(col) {
    this.state.cursorCol = col;
    this.preferredVisualCol = null;
    this.snappedFromCursorCol = null;
  }
  /**
   * Move cursor to a target visual line, applying sticky column logic.
   * Shared by moveCursor() and pageScroll().
   */
  moveToVisualLine(visualLines, currentVisualLine, targetVisualLine) {
    const currentVL = visualLines[currentVisualLine];
    const targetVL = visualLines[targetVisualLine];
    if (!(currentVL && targetVL)) return;
    let currentVisualCol;
    if (this.snappedFromCursorCol !== null) {
      const vlIndex = this.findVisualLineAt(visualLines, currentVL.logicalLine, this.snappedFromCursorCol);
      currentVisualCol = this.snappedFromCursorCol - visualLines[vlIndex].startCol;
    } else {
      currentVisualCol = this.state.cursorCol - currentVL.startCol;
    }
    const isLastSourceSegment = currentVisualLine === visualLines.length - 1 || visualLines[currentVisualLine + 1]?.logicalLine !== currentVL.logicalLine;
    const sourceMaxVisualCol = isLastSourceSegment ? currentVL.length : Math.max(0, currentVL.length - 1);
    const isLastTargetSegment = targetVisualLine === visualLines.length - 1 || visualLines[targetVisualLine + 1]?.logicalLine !== targetVL.logicalLine;
    const targetMaxVisualCol = isLastTargetSegment ? targetVL.length : Math.max(0, targetVL.length - 1);
    const moveToVisualCol = this.computeVerticalMoveColumn(currentVisualCol, sourceMaxVisualCol, targetMaxVisualCol);
    this.state.cursorLine = targetVL.logicalLine;
    const targetCol = targetVL.startCol + moveToVisualCol;
    const logicalLine = this.state.lines[targetVL.logicalLine] || "";
    this.state.cursorCol = Math.min(targetCol, logicalLine.length);
    const segments = [...this.segment(logicalLine, "grapheme")];
    for (const seg of segments) {
      if (seg.index > this.state.cursorCol) break;
      if (seg.segment.length <= 1) continue;
      if (this.state.cursorCol < seg.index + seg.segment.length) {
        const isContinuation = seg.index < targetVL.startCol;
        const isMovingDown = targetVisualLine > currentVisualLine;
        if (isContinuation && isMovingDown) {
          const segEnd = seg.index + seg.segment.length;
          let next = targetVisualLine + 1;
          while (next < visualLines.length && visualLines[next].logicalLine === targetVL.logicalLine && visualLines[next].startCol < segEnd) {
            next++;
          }
          if (next < visualLines.length) {
            this.moveToVisualLine(visualLines, currentVisualLine, next);
            return;
          }
        }
        this.snappedFromCursorCol = this.state.cursorCol;
        this.state.cursorCol = seg.index;
        return;
      }
    }
    this.snappedFromCursorCol = null;
  }
  /**
   * Compute the target visual column for vertical cursor movement.
   * Implements the sticky column decision table:
   *
   * | P | S | T | U | Scenario                                             | Set Preferred | Move To     |
   * |---|---|---|---| ---------------------------------------------------- |---------------|-------------|
   * | 0 | * | 0 | - | Start nav, target fits                               | null          | current     |
   * | 0 | * | 1 | - | Start nav, target shorter                            | current       | target end  |
   * | 1 | 0 | 0 | 0 | Clamped, target fits preferred                       | null          | preferred   |
   * | 1 | 0 | 0 | 1 | Clamped, target longer but still can't fit preferred | keep          | target end  |
   * | 1 | 0 | 1 | - | Clamped, target even shorter                         | keep          | target end  |
   * | 1 | 1 | 0 | - | Rewrapped, target fits current                       | null          | current     |
   * | 1 | 1 | 1 | - | Rewrapped, target shorter than current               | current       | target end  |
   *
   * Where:
   * - P = preferred col is set
   * - S = cursor in middle of source line (not clamped to end)
   * - T = target line shorter than current visual col
   * - U = target line shorter than preferred col
   */
  computeVerticalMoveColumn(currentVisualCol, sourceMaxVisualCol, targetMaxVisualCol) {
    const hasPreferred = this.preferredVisualCol !== null;
    const cursorInMiddle = currentVisualCol < sourceMaxVisualCol;
    const targetTooShort = targetMaxVisualCol < currentVisualCol;
    if (!hasPreferred || cursorInMiddle) {
      if (targetTooShort) {
        this.preferredVisualCol = currentVisualCol;
        return targetMaxVisualCol;
      }
      this.preferredVisualCol = null;
      return currentVisualCol;
    }
    const targetCantFitPreferred = targetMaxVisualCol < this.preferredVisualCol;
    if (targetTooShort || targetCantFitPreferred) {
      return targetMaxVisualCol;
    }
    const result = this.preferredVisualCol;
    this.preferredVisualCol = null;
    return result;
  }
  moveToLineStart() {
    this.lastAction = null;
    this.setCursorCol(0);
  }
  moveToLineEnd() {
    this.lastAction = null;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    this.setCursorCol(currentLine.length);
  }
  deleteToStartOfLine() {
    this.exitHistoryBrowsing();
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol > 0) {
      this.pushUndoSnapshot();
      const deletedText = currentLine.slice(0, this.state.cursorCol);
      this.killRing.push(deletedText, { prepend: true, accumulate: this.lastAction === "kill" });
      this.lastAction = "kill";
      this.state.lines[this.state.cursorLine] = currentLine.slice(this.state.cursorCol);
      this.setCursorCol(0);
    } else if (this.state.cursorLine > 0) {
      this.pushUndoSnapshot();
      this.killRing.push("\n", { prepend: true, accumulate: this.lastAction === "kill" });
      this.lastAction = "kill";
      const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
      this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
      this.state.lines.splice(this.state.cursorLine, 1);
      this.state.cursorLine--;
      this.setCursorCol(previousLine.length);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  deleteToEndOfLine() {
    this.exitHistoryBrowsing();
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol < currentLine.length) {
      this.pushUndoSnapshot();
      const deletedText = currentLine.slice(this.state.cursorCol);
      this.killRing.push(deletedText, { prepend: false, accumulate: this.lastAction === "kill" });
      this.lastAction = "kill";
      this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol);
    } else if (this.state.cursorLine < this.state.lines.length - 1) {
      this.pushUndoSnapshot();
      this.killRing.push("\n", { prepend: false, accumulate: this.lastAction === "kill" });
      this.lastAction = "kill";
      const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
      this.state.lines[this.state.cursorLine] = currentLine + nextLine;
      this.state.lines.splice(this.state.cursorLine + 1, 1);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  deleteWordBackwards() {
    this.exitHistoryBrowsing();
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol === 0) {
      if (this.state.cursorLine > 0) {
        this.pushUndoSnapshot();
        this.killRing.push("\n", { prepend: true, accumulate: this.lastAction === "kill" });
        this.lastAction = "kill";
        const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
        this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
        this.state.lines.splice(this.state.cursorLine, 1);
        this.state.cursorLine--;
        this.setCursorCol(previousLine.length);
      }
    } else {
      this.pushUndoSnapshot();
      const wasKill = this.lastAction === "kill";
      const oldCursorCol = this.state.cursorCol;
      this.moveWordBackwards();
      const deleteFrom = this.state.cursorCol;
      this.setCursorCol(oldCursorCol);
      const deletedText = currentLine.slice(deleteFrom, this.state.cursorCol);
      this.killRing.push(deletedText, { prepend: true, accumulate: wasKill });
      this.lastAction = "kill";
      this.state.lines[this.state.cursorLine] = currentLine.slice(0, deleteFrom) + currentLine.slice(this.state.cursorCol);
      this.setCursorCol(deleteFrom);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  deleteWordForward() {
    this.exitHistoryBrowsing();
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol >= currentLine.length) {
      if (this.state.cursorLine < this.state.lines.length - 1) {
        this.pushUndoSnapshot();
        this.killRing.push("\n", { prepend: false, accumulate: this.lastAction === "kill" });
        this.lastAction = "kill";
        const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
        this.state.lines[this.state.cursorLine] = currentLine + nextLine;
        this.state.lines.splice(this.state.cursorLine + 1, 1);
      }
    } else {
      this.pushUndoSnapshot();
      const wasKill = this.lastAction === "kill";
      const oldCursorCol = this.state.cursorCol;
      this.moveWordForwards();
      const deleteTo = this.state.cursorCol;
      this.setCursorCol(oldCursorCol);
      const deletedText = currentLine.slice(this.state.cursorCol, deleteTo);
      this.killRing.push(deletedText, { prepend: false, accumulate: wasKill });
      this.lastAction = "kill";
      this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol) + currentLine.slice(deleteTo);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  handleForwardDelete() {
    this.exitHistoryBrowsing();
    this.lastAction = null;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol < currentLine.length) {
      this.pushUndoSnapshot();
      const afterCursor = currentLine.slice(this.state.cursorCol);
      const graphemes = [...this.segment(afterCursor, "grapheme")];
      const firstGrapheme = graphemes[0];
      const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
      const before = currentLine.slice(0, this.state.cursorCol);
      const after = currentLine.slice(this.state.cursorCol + graphemeLength);
      this.state.lines[this.state.cursorLine] = before + after;
    } else if (this.state.cursorLine < this.state.lines.length - 1) {
      this.pushUndoSnapshot();
      const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
      this.state.lines[this.state.cursorLine] = currentLine + nextLine;
      this.state.lines.splice(this.state.cursorLine + 1, 1);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
    if (this.autocompleteState) {
      this.updateAutocomplete();
    } else {
      const currentLine2 = this.state.lines[this.state.cursorLine] || "";
      const textBeforeCursor = currentLine2.slice(0, this.state.cursorCol);
      if (this.isInSlashCommandContext(textBeforeCursor)) {
        this.tryTriggerAutocomplete();
      } else if (this.autocompleteTriggerPattern.test(textBeforeCursor)) {
        this.tryTriggerAutocomplete();
      }
    }
  }
  /**
   * Build a mapping from visual lines to logical positions.
   * Returns an array where each element represents a visual line with:
   * - logicalLine: index into this.state.lines
   * - startCol: starting column in the logical line
   * - length: length of this visual line segment
   */
  buildVisualLineMap(width) {
    const visualLines = [];
    for (let i = 0; i < this.state.lines.length; i++) {
      const line = this.state.lines[i] || "";
      const lineVisWidth = visibleWidth(line);
      if (line.length === 0) {
        visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
      } else if (lineVisWidth <= width) {
        visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
      } else {
        const chunks = wordWrapLine(line, width, [...this.segment(line, "grapheme")]);
        for (const chunk of chunks) {
          visualLines.push({
            logicalLine: i,
            startCol: chunk.startIndex,
            length: chunk.endIndex - chunk.startIndex
          });
        }
      }
    }
    return visualLines;
  }
  /**
   * Find the visual line index that contains the given logical position.
   */
  findVisualLineAt(visualLines, line, col) {
    for (let i = 0; i < visualLines.length; i++) {
      const vl = visualLines[i];
      if (!vl || vl.logicalLine !== line) continue;
      const offset = col - vl.startCol;
      const isLastSegmentOfLine = i === visualLines.length - 1 || visualLines[i + 1]?.logicalLine !== vl.logicalLine;
      if (offset >= 0 && (offset < vl.length || isLastSegmentOfLine && offset === vl.length)) {
        return i;
      }
    }
    return visualLines.length - 1;
  }
  /**
   * Find the visual line index for the current cursor position.
   */
  findCurrentVisualLine(visualLines) {
    return this.findVisualLineAt(visualLines, this.state.cursorLine, this.state.cursorCol);
  }
  moveCursor(deltaLine, deltaCol) {
    this.lastAction = null;
    const visualLines = this.buildVisualLineMap(this.lastWidth);
    const currentVisualLine = this.findCurrentVisualLine(visualLines);
    if (deltaLine !== 0) {
      const targetVisualLine = currentVisualLine + deltaLine;
      if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
        this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
      }
    }
    if (deltaCol !== 0) {
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      if (deltaCol > 0) {
        if (this.state.cursorCol < currentLine.length) {
          const afterCursor = currentLine.slice(this.state.cursorCol);
          const graphemes = [...this.segment(afterCursor, "grapheme")];
          const firstGrapheme = graphemes[0];
          this.setCursorCol(this.state.cursorCol + (firstGrapheme ? firstGrapheme.segment.length : 1));
        } else if (this.state.cursorLine < this.state.lines.length - 1) {
          this.state.cursorLine++;
          this.setCursorCol(0);
        } else {
          const currentVL = visualLines[currentVisualLine];
          if (currentVL) {
            this.preferredVisualCol = this.state.cursorCol - currentVL.startCol;
          }
        }
      } else {
        if (this.state.cursorCol > 0) {
          const beforeCursor = currentLine.slice(0, this.state.cursorCol);
          const graphemes = [...this.segment(beforeCursor, "grapheme")];
          const lastGrapheme = graphemes[graphemes.length - 1];
          this.setCursorCol(this.state.cursorCol - (lastGrapheme ? lastGrapheme.segment.length : 1));
        } else if (this.state.cursorLine > 0) {
          this.state.cursorLine--;
          const prevLine = this.state.lines[this.state.cursorLine] || "";
          this.setCursorCol(prevLine.length);
        }
      }
    }
    if (this.autocompleteState) {
      this.updateAutocomplete();
    }
  }
  /**
   * Scroll by a page (direction: -1 for up, 1 for down).
   * Moves cursor by the page size while keeping it in bounds.
   */
  pageScroll(direction) {
    this.lastAction = null;
    const terminalRows = this.tui.terminal.rows;
    const pageSize = Math.max(5, Math.floor(terminalRows * 0.3));
    const visualLines = this.buildVisualLineMap(this.lastWidth);
    const currentVisualLine = this.findCurrentVisualLine(visualLines);
    const targetVisualLine = Math.max(0, Math.min(visualLines.length - 1, currentVisualLine + direction * pageSize));
    this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
  }
  moveWordBackwards() {
    this.lastAction = null;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol === 0) {
      if (this.state.cursorLine > 0) {
        this.state.cursorLine--;
        const prevLine = this.state.lines[this.state.cursorLine] || "";
        this.setCursorCol(prevLine.length);
      }
      return;
    }
    this.setCursorCol(
      findWordBackward(currentLine, this.state.cursorCol, {
        segment: (text) => this.segment(text, "word"),
        isAtomicSegment: isPasteMarker
      })
    );
  }
  /**
   * Yank (paste) the most recent kill ring entry at cursor position.
   */
  yank() {
    if (this.killRing.length === 0) return;
    this.pushUndoSnapshot();
    const text = this.killRing.peek();
    this.insertYankedText(text);
    this.lastAction = "yank";
  }
  /**
   * Cycle through kill ring (only works immediately after yank or yank-pop).
   * Replaces the last yanked text with the previous entry in the ring.
   */
  yankPop() {
    if (this.lastAction !== "yank" || this.killRing.length <= 1) return;
    this.pushUndoSnapshot();
    this.deleteYankedText();
    this.killRing.rotate();
    const text = this.killRing.peek();
    this.insertYankedText(text);
    this.lastAction = "yank";
  }
  /**
   * Insert text at cursor position (used by yank operations).
   */
  insertYankedText(text) {
    this.exitHistoryBrowsing();
    const lines = text.split("\n");
    if (lines.length === 1) {
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      const before = currentLine.slice(0, this.state.cursorCol);
      const after = currentLine.slice(this.state.cursorCol);
      this.state.lines[this.state.cursorLine] = before + text + after;
      this.setCursorCol(this.state.cursorCol + text.length);
    } else {
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      const before = currentLine.slice(0, this.state.cursorCol);
      const after = currentLine.slice(this.state.cursorCol);
      this.state.lines[this.state.cursorLine] = before + (lines[0] || "");
      for (let i = 1; i < lines.length - 1; i++) {
        this.state.lines.splice(this.state.cursorLine + i, 0, lines[i] || "");
      }
      const lastLineIndex = this.state.cursorLine + lines.length - 1;
      this.state.lines.splice(lastLineIndex, 0, (lines[lines.length - 1] || "") + after);
      this.state.cursorLine = lastLineIndex;
      this.setCursorCol((lines[lines.length - 1] || "").length);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  /**
   * Delete the previously yanked text (used by yank-pop).
   * The yanked text is derived from killRing[end] since it hasn't been rotated yet.
   */
  deleteYankedText() {
    const yankedText = this.killRing.peek();
    if (!yankedText) return;
    const yankLines = yankedText.split("\n");
    if (yankLines.length === 1) {
      const currentLine = this.state.lines[this.state.cursorLine] || "";
      const deleteLen = yankedText.length;
      const before = currentLine.slice(0, this.state.cursorCol - deleteLen);
      const after = currentLine.slice(this.state.cursorCol);
      this.state.lines[this.state.cursorLine] = before + after;
      this.setCursorCol(this.state.cursorCol - deleteLen);
    } else {
      const startLine = this.state.cursorLine - (yankLines.length - 1);
      const startCol = (this.state.lines[startLine] || "").length - (yankLines[0] || "").length;
      const afterCursor = (this.state.lines[this.state.cursorLine] || "").slice(this.state.cursorCol);
      const beforeYank = (this.state.lines[startLine] || "").slice(0, startCol);
      this.state.lines.splice(startLine, yankLines.length, beforeYank + afterCursor);
      this.state.cursorLine = startLine;
      this.setCursorCol(startCol);
    }
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  pushUndoSnapshot() {
    this.undoStack.push({ state: this.state, pastes: this.pastes, pasteCounter: this.pasteCounter });
  }
  undo() {
    this.exitHistoryBrowsing();
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    Object.assign(this.state, snapshot.state);
    this.pastes = snapshot.pastes;
    this.pasteCounter = snapshot.pasteCounter;
    this.lastAction = null;
    this.preferredVisualCol = null;
    if (this.onChange) {
      this.onChange(this.getText());
    }
  }
  /**
   * Jump to the first occurrence of a character in the specified direction.
   * Multi-line search. Case-sensitive. Skips the current cursor position.
   */
  jumpToChar(char, direction) {
    this.lastAction = null;
    const isForward = direction === "forward";
    const lines = this.state.lines;
    const end = isForward ? lines.length : -1;
    const step = isForward ? 1 : -1;
    for (let lineIdx = this.state.cursorLine; lineIdx !== end; lineIdx += step) {
      const line = lines[lineIdx] || "";
      const isCurrentLine = lineIdx === this.state.cursorLine;
      const searchFrom = isCurrentLine ? isForward ? this.state.cursorCol + 1 : this.state.cursorCol - 1 : void 0;
      const idx = isForward ? line.indexOf(char, searchFrom) : line.lastIndexOf(char, searchFrom);
      if (idx !== -1) {
        this.state.cursorLine = lineIdx;
        this.setCursorCol(idx);
        return;
      }
    }
  }
  moveWordForwards() {
    this.lastAction = null;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    if (this.state.cursorCol >= currentLine.length) {
      if (this.state.cursorLine < this.state.lines.length - 1) {
        this.state.cursorLine++;
        this.setCursorCol(0);
      }
      return;
    }
    this.setCursorCol(
      findWordForward(currentLine, this.state.cursorCol, {
        segment: (text) => this.segment(text, "word"),
        isAtomicSegment: isPasteMarker
      })
    );
  }
  // Slash menu only allowed on the first line of the editor
  isSlashMenuAllowed() {
    return this.state.cursorLine === 0;
  }
  // Helper method to check if cursor is at start of message (for slash command detection)
  isAtStartOfMessage() {
    if (!this.isSlashMenuAllowed()) return false;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    const beforeCursor = currentLine.slice(0, this.state.cursorCol);
    return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
  }
  isInSlashCommandContext(textBeforeCursor) {
    return this.isSlashMenuAllowed() && textBeforeCursor.trimStart().startsWith("/");
  }
  // Autocomplete methods
  /**
   * Find the best autocomplete item index for the given prefix.
   * Returns -1 if no match is found.
   *
   * Match priority:
   * 1. Exact match (prefix === item.value) -> always selected
   * 2. Prefix match -> first item whose value starts with prefix
   * 3. No match -> -1 (keep default highlight)
   *
   * Matching is case-sensitive and checks item.value only.
   */
  getBestAutocompleteMatchIndex(items, prefix) {
    if (!prefix) return -1;
    let firstPrefixIndex = -1;
    for (let i = 0; i < items.length; i++) {
      const value = items[i].value;
      if (value === prefix) {
        return i;
      }
      if (firstPrefixIndex === -1 && value.startsWith(prefix)) {
        firstPrefixIndex = i;
      }
    }
    return firstPrefixIndex;
  }
  createAutocompleteList(prefix, items) {
    const layout = prefix.startsWith("/") ? SLASH_COMMAND_SELECT_LIST_LAYOUT : void 0;
    return new SelectList(items, this.autocompleteMaxVisible, this.theme.selectList, layout);
  }
  tryTriggerAutocomplete(explicitTab = false) {
    this.requestAutocomplete({ force: false, explicitTab });
  }
  handleTabCompletion() {
    if (!this.autocompleteProvider) return;
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    const beforeCursor = currentLine.slice(0, this.state.cursorCol);
    if (this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ")) {
      this.handleSlashCommandCompletion();
    } else {
      this.forceFileAutocomplete(true);
    }
  }
  handleSlashCommandCompletion() {
    this.requestAutocomplete({ force: false, explicitTab: true });
  }
  forceFileAutocomplete(explicitTab = false) {
    this.requestAutocomplete({ force: true, explicitTab });
  }
  requestAutocomplete(options) {
    if (!this.autocompleteProvider) return;
    if (options.force) {
      const shouldTrigger = !this.autocompleteProvider.shouldTriggerFileCompletion || this.autocompleteProvider.shouldTriggerFileCompletion(
        this.state.lines,
        this.state.cursorLine,
        this.state.cursorCol
      );
      if (!shouldTrigger) {
        return;
      }
    }
    this.cancelAutocompleteRequest();
    const startToken = ++this.autocompleteStartToken;
    const debounceMs = this.getAutocompleteDebounceMs(options);
    if (debounceMs > 0) {
      this.autocompleteDebounceTimer = setTimeout(() => {
        this.autocompleteDebounceTimer = void 0;
        void this.startAutocompleteRequest(startToken, options);
      }, debounceMs);
      return;
    }
    void this.startAutocompleteRequest(startToken, options);
  }
  async startAutocompleteRequest(startToken, options) {
    const previousTask = this.autocompleteRequestTask;
    this.autocompleteRequestTask = (async () => {
      await previousTask;
      if (startToken !== this.autocompleteStartToken || !this.autocompleteProvider) {
        return;
      }
      const controller = new AbortController();
      this.autocompleteAbort = controller;
      const requestId = ++this.autocompleteRequestId;
      const snapshotText = this.getText();
      const snapshotLine = this.state.cursorLine;
      const snapshotCol = this.state.cursorCol;
      await this.runAutocompleteRequest(requestId, controller, snapshotText, snapshotLine, snapshotCol, options);
    })();
    await this.autocompleteRequestTask;
  }
  setAutocompleteTriggerCharacters(triggerCharacters) {
    const next = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
    for (const character of triggerCharacters) {
      if (character.length !== 1 || character === "/" || isWhitespaceChar(character) || next.includes(character)) {
        continue;
      }
      next.push(character);
    }
    this.autocompleteTriggerCharacters = next;
    this.autocompleteTriggerPattern = buildTriggerPattern(next);
    this.autocompleteDebouncePattern = buildDebouncePattern(next);
  }
  getAutocompleteDebounceMs(options) {
    if (options.explicitTab || options.force) {
      return 0;
    }
    const currentLine = this.state.lines[this.state.cursorLine] || "";
    const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
    return this.autocompleteDebouncePattern.test(textBeforeCursor) ? ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS : 0;
  }
  async runAutocompleteRequest(requestId, controller, snapshotText, snapshotLine, snapshotCol, options) {
    if (!this.autocompleteProvider) return;
    const suggestions = await this.autocompleteProvider.getSuggestions(
      this.state.lines,
      this.state.cursorLine,
      this.state.cursorCol,
      { signal: controller.signal, force: options.force }
    );
    if (!this.isAutocompleteRequestCurrent(requestId, controller, snapshotText, snapshotLine, snapshotCol)) {
      return;
    }
    this.autocompleteAbort = void 0;
    if (!suggestions || !Array.isArray(suggestions.items) || suggestions.items.length === 0) {
      this.cancelAutocomplete();
      this.tui.requestRender();
      return;
    }
    if (options.force && options.explicitTab && suggestions.items.length === 1) {
      const item = suggestions.items[0];
      this.pushUndoSnapshot();
      this.lastAction = null;
      const result = this.autocompleteProvider.applyCompletion(
        this.state.lines,
        this.state.cursorLine,
        this.state.cursorCol,
        item,
        suggestions.prefix
      );
      this.state.lines = result.lines;
      this.state.cursorLine = result.cursorLine;
      this.setCursorCol(result.cursorCol);
      if (this.onChange) this.onChange(this.getText());
      this.tui.requestRender();
      return;
    }
    this.applyAutocompleteSuggestions(suggestions, options.force ? "force" : "regular");
    this.tui.requestRender();
  }
  isAutocompleteRequestCurrent(requestId, controller, snapshotText, snapshotLine, snapshotCol) {
    return !controller.signal.aborted && requestId === this.autocompleteRequestId && this.getText() === snapshotText && this.state.cursorLine === snapshotLine && this.state.cursorCol === snapshotCol;
  }
  applyAutocompleteSuggestions(suggestions, state) {
    this.autocompletePrefix = suggestions.prefix;
    this.autocompleteList = this.createAutocompleteList(suggestions.prefix, suggestions.items);
    const bestMatchIndex = this.getBestAutocompleteMatchIndex(suggestions.items, suggestions.prefix);
    if (bestMatchIndex >= 0) {
      this.autocompleteList.setSelectedIndex(bestMatchIndex);
    }
    this.autocompleteState = state;
  }
  cancelAutocompleteRequest() {
    this.autocompleteStartToken += 1;
    if (this.autocompleteDebounceTimer) {
      clearTimeout(this.autocompleteDebounceTimer);
      this.autocompleteDebounceTimer = void 0;
    }
    this.autocompleteAbort?.abort();
    this.autocompleteAbort = void 0;
  }
  clearAutocompleteUi() {
    this.autocompleteState = null;
    this.autocompleteList = void 0;
    this.autocompletePrefix = "";
  }
  cancelAutocomplete() {
    this.cancelAutocompleteRequest();
    this.clearAutocompleteUi();
  }
  isShowingAutocomplete() {
    return this.autocompleteState !== null;
  }
  updateAutocomplete() {
    if (!this.autocompleteState || !this.autocompleteProvider) return;
    this.requestAutocomplete({ force: this.autocompleteState === "force", explicitTab: false });
  }
};

// tui/src/components/image.ts
var Image = class {
  base64Data;
  mimeType;
  dimensions;
  theme;
  options;
  imageId;
  cachedLines;
  cachedWidth;
  constructor(base64Data, mimeType, theme, options = {}, dimensions) {
    this.base64Data = base64Data;
    this.mimeType = mimeType;
    this.theme = theme;
    this.options = options;
    this.dimensions = dimensions || getImageDimensions(base64Data, mimeType) || { widthPx: 800, heightPx: 600 };
    this.imageId = options.imageId;
  }
  /** Get the Kitty image ID used by this image (if any). */
  getImageId() {
    return this.imageId;
  }
  invalidate() {
    this.cachedLines = void 0;
    this.cachedWidth = void 0;
  }
  render(width) {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const maxWidth = Math.max(1, Math.min(width - 2, this.options.maxWidthCells ?? 60));
    const cellDimensions2 = getCellDimensions();
    const defaultMaxHeight = Math.max(1, Math.ceil(maxWidth * cellDimensions2.widthPx / cellDimensions2.heightPx));
    const maxHeight = this.options.maxHeightCells ?? defaultMaxHeight;
    const caps = getCapabilities();
    let lines;
    if (caps.images) {
      if (caps.images === "kitty" && this.imageId === void 0) {
        this.imageId = allocateImageId();
      }
      const result = renderImage(this.base64Data, this.dimensions, {
        maxWidthCells: maxWidth,
        maxHeightCells: maxHeight,
        imageId: this.imageId,
        moveCursor: false
      });
      if (result) {
        if (result.imageId) {
          this.imageId = result.imageId;
        }
        if (caps.images === "kitty") {
          lines = [result.sequence];
          for (let i = 0; i < result.rows - 1; i++) {
            lines.push("");
          }
        } else {
          lines = [];
          for (let i = 0; i < result.rows - 1; i++) {
            lines.push("");
          }
          const rowOffset = result.rows - 1;
          const moveUp = rowOffset > 0 ? `\x1B[${rowOffset}A` : "";
          lines.push(moveUp + result.sequence);
        }
      } else {
        const fallback = imageFallback(this.mimeType, this.dimensions, this.options.filename);
        lines = [truncateToWidth(this.theme.fallbackColor(fallback), width)];
      }
    } else {
      const fallback = imageFallback(this.mimeType, this.dimensions, this.options.filename);
      lines = [truncateToWidth(this.theme.fallbackColor(fallback), width)];
    }
    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }
};

// tui/src/components/input.ts
var segmenter = getGraphemeSegmenter();
var Input = class {
  value = "";
  cursor = 0;
  // Cursor position in the value
  onSubmit;
  onEscape;
  /** Focusable interface - set by TUI when focus changes */
  focused = false;
  // Bracketed paste mode buffering
  pasteBuffer = "";
  isInPaste = false;
  // Kill ring for Emacs-style kill/yank operations
  killRing = new KillRing();
  lastAction = null;
  // Undo support
  undoStack = new UndoStack();
  getValue() {
    return this.value;
  }
  setValue(value) {
    this.value = value;
    this.cursor = Math.min(this.cursor, value.length);
  }
  handleInput(data) {
    if (data.includes("\x1B[200~")) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      data = data.replace("\x1B[200~", "");
    }
    if (this.isInPaste) {
      this.pasteBuffer += data;
      const endIndex = this.pasteBuffer.indexOf("\x1B[201~");
      if (endIndex !== -1) {
        const pasteContent = this.pasteBuffer.substring(0, endIndex);
        this.handlePaste(pasteContent);
        this.isInPaste = false;
        const remaining = this.pasteBuffer.substring(endIndex + 6);
        this.pasteBuffer = "";
        if (remaining) {
          this.handleInput(remaining);
        }
      }
      return;
    }
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.onEscape) this.onEscape();
      return;
    }
    if (kb.matches(data, "tui.editor.undo")) {
      this.undo();
      return;
    }
    if (kb.matches(data, "tui.input.submit") || data === "\n") {
      if (this.onSubmit) this.onSubmit(this.value);
      return;
    }
    if (kb.matches(data, "tui.editor.deleteCharBackward")) {
      this.handleBackspace();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteCharForward")) {
      this.handleForwardDelete();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteWordBackward")) {
      this.deleteWordBackwards();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteWordForward")) {
      this.deleteWordForward();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteToLineStart")) {
      this.deleteToLineStart();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
      this.deleteToLineEnd();
      return;
    }
    if (kb.matches(data, "tui.editor.yank")) {
      this.yank();
      return;
    }
    if (kb.matches(data, "tui.editor.yankPop")) {
      this.yankPop();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLeft")) {
      this.lastAction = null;
      if (this.cursor > 0) {
        const beforeCursor = this.value.slice(0, this.cursor);
        const graphemes = [...segmenter.segment(beforeCursor)];
        const lastGrapheme = graphemes[graphemes.length - 1];
        this.cursor -= lastGrapheme ? lastGrapheme.segment.length : 1;
      }
      return;
    }
    if (kb.matches(data, "tui.editor.cursorRight")) {
      this.lastAction = null;
      if (this.cursor < this.value.length) {
        const afterCursor = this.value.slice(this.cursor);
        const graphemes = [...segmenter.segment(afterCursor)];
        const firstGrapheme = graphemes[0];
        this.cursor += firstGrapheme ? firstGrapheme.segment.length : 1;
      }
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLineStart")) {
      this.lastAction = null;
      this.cursor = 0;
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLineEnd")) {
      this.lastAction = null;
      this.cursor = this.value.length;
      return;
    }
    if (kb.matches(data, "tui.editor.cursorWordLeft")) {
      this.moveWordBackwards();
      return;
    }
    if (kb.matches(data, "tui.editor.cursorWordRight")) {
      this.moveWordForwards();
      return;
    }
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable !== void 0) {
      this.insertCharacter(kittyPrintable);
      return;
    }
    const hasControlChars = [...data].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 || code >= 128 && code <= 159;
    });
    if (!hasControlChars) {
      this.insertCharacter(data);
    }
  }
  insertCharacter(char) {
    if (isWhitespaceChar(char) || this.lastAction !== "type-word") {
      this.pushUndo();
    }
    this.lastAction = "type-word";
    this.value = this.value.slice(0, this.cursor) + char + this.value.slice(this.cursor);
    this.cursor += char.length;
  }
  handleBackspace() {
    this.lastAction = null;
    if (this.cursor > 0) {
      this.pushUndo();
      const beforeCursor = this.value.slice(0, this.cursor);
      const graphemes = [...segmenter.segment(beforeCursor)];
      const lastGrapheme = graphemes[graphemes.length - 1];
      const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
      this.value = this.value.slice(0, this.cursor - graphemeLength) + this.value.slice(this.cursor);
      this.cursor -= graphemeLength;
    }
  }
  handleForwardDelete() {
    this.lastAction = null;
    if (this.cursor < this.value.length) {
      this.pushUndo();
      const afterCursor = this.value.slice(this.cursor);
      const graphemes = [...segmenter.segment(afterCursor)];
      const firstGrapheme = graphemes[0];
      const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
      this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + graphemeLength);
    }
  }
  deleteToLineStart() {
    if (this.cursor === 0) return;
    this.pushUndo();
    const deletedText = this.value.slice(0, this.cursor);
    this.killRing.push(deletedText, { prepend: true, accumulate: this.lastAction === "kill" });
    this.lastAction = "kill";
    this.value = this.value.slice(this.cursor);
    this.cursor = 0;
  }
  deleteToLineEnd() {
    if (this.cursor >= this.value.length) return;
    this.pushUndo();
    const deletedText = this.value.slice(this.cursor);
    this.killRing.push(deletedText, { prepend: false, accumulate: this.lastAction === "kill" });
    this.lastAction = "kill";
    this.value = this.value.slice(0, this.cursor);
  }
  deleteWordBackwards() {
    if (this.cursor === 0) return;
    const wasKill = this.lastAction === "kill";
    this.pushUndo();
    const oldCursor = this.cursor;
    this.moveWordBackwards();
    const deleteFrom = this.cursor;
    this.cursor = oldCursor;
    const deletedText = this.value.slice(deleteFrom, this.cursor);
    this.killRing.push(deletedText, { prepend: true, accumulate: wasKill });
    this.lastAction = "kill";
    this.value = this.value.slice(0, deleteFrom) + this.value.slice(this.cursor);
    this.cursor = deleteFrom;
  }
  deleteWordForward() {
    if (this.cursor >= this.value.length) return;
    const wasKill = this.lastAction === "kill";
    this.pushUndo();
    const oldCursor = this.cursor;
    this.moveWordForwards();
    const deleteTo = this.cursor;
    this.cursor = oldCursor;
    const deletedText = this.value.slice(this.cursor, deleteTo);
    this.killRing.push(deletedText, { prepend: false, accumulate: wasKill });
    this.lastAction = "kill";
    this.value = this.value.slice(0, this.cursor) + this.value.slice(deleteTo);
  }
  yank() {
    const text = this.killRing.peek();
    if (!text) return;
    this.pushUndo();
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.lastAction = "yank";
  }
  yankPop() {
    if (this.lastAction !== "yank" || this.killRing.length <= 1) return;
    this.pushUndo();
    const prevText = this.killRing.peek() || "";
    this.value = this.value.slice(0, this.cursor - prevText.length) + this.value.slice(this.cursor);
    this.cursor -= prevText.length;
    this.killRing.rotate();
    const text = this.killRing.peek() || "";
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.lastAction = "yank";
  }
  pushUndo() {
    this.undoStack.push({ value: this.value, cursor: this.cursor });
  }
  undo() {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.value = snapshot.value;
    this.cursor = snapshot.cursor;
    this.lastAction = null;
  }
  moveWordBackwards() {
    if (this.cursor === 0) return;
    this.lastAction = null;
    this.cursor = findWordBackward(this.value, this.cursor);
  }
  moveWordForwards() {
    if (this.cursor >= this.value.length) return;
    this.lastAction = null;
    this.cursor = findWordForward(this.value, this.cursor);
  }
  handlePaste(pastedText) {
    this.lastAction = null;
    this.pushUndo();
    const cleanText = pastedText.replace(/\r\n/g, "").replace(/\r/g, "").replace(/\n/g, "").replace(/\t/g, "    ");
    this.value = this.value.slice(0, this.cursor) + cleanText + this.value.slice(this.cursor);
    this.cursor += cleanText.length;
  }
  invalidate() {
  }
  render(width) {
    const prompt = "> ";
    const availableWidth = width - prompt.length;
    if (availableWidth <= 0) {
      return [prompt];
    }
    let visibleText = "";
    let cursorDisplay = this.cursor;
    const totalWidth = visibleWidth(this.value);
    if (totalWidth < availableWidth) {
      visibleText = this.value;
    } else {
      const scrollWidth = this.cursor === this.value.length ? availableWidth - 1 : availableWidth;
      const cursorCol = visibleWidth(this.value.slice(0, this.cursor));
      if (scrollWidth > 0) {
        const halfWidth = Math.floor(scrollWidth / 2);
        let startCol = 0;
        if (cursorCol < halfWidth) {
          startCol = 0;
        } else if (cursorCol > totalWidth - halfWidth) {
          startCol = Math.max(0, totalWidth - scrollWidth);
        } else {
          startCol = Math.max(0, cursorCol - halfWidth);
        }
        visibleText = sliceByColumn(this.value, startCol, scrollWidth, true);
        const beforeCursor2 = sliceByColumn(this.value, startCol, Math.max(0, cursorCol - startCol), true);
        cursorDisplay = beforeCursor2.length;
      } else {
        visibleText = "";
        cursorDisplay = 0;
      }
    }
    const graphemes = [...segmenter.segment(visibleText.slice(cursorDisplay))];
    const cursorGrapheme = graphemes[0];
    const beforeCursor = visibleText.slice(0, cursorDisplay);
    const atCursor = cursorGrapheme?.segment ?? " ";
    const afterCursor = visibleText.slice(cursorDisplay + atCursor.length);
    const marker = this.focused ? CURSOR_MARKER : "";
    const cursorChar = `\x1B[7m${atCursor}\x1B[27m`;
    const textWithCursor = beforeCursor + marker + cursorChar + afterCursor;
    const visualLength = visibleWidth(textWithCursor);
    const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
    const line = prompt + textWithCursor + padding;
    return [line];
  }
};

// tui/src/components/markdown.ts
import { Marked, Tokenizer } from "marked";
var STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;
var StrictStrikethroughTokenizer = class extends Tokenizer {
  del(src) {
    const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
    if (!match) {
      return void 0;
    }
    const text = match[2];
    return {
      type: "del",
      raw: match[0],
      text,
      tokens: this.lexer.inlineTokens(text)
    };
  }
};
function trimPartialClosingFences(tokens) {
  const token = tokens[tokens.length - 1];
  if (token?.type === "list") {
    trimPartialClosingFences(token.items[token.items.length - 1]?.tokens ?? []);
    return;
  }
  if (token?.type === "blockquote") {
    trimPartialClosingFences(token.tokens ?? []);
    return;
  }
  if (token?.type !== "code") {
    return;
  }
  const marker = /^(`{3,}|~{3,})/.exec(token.raw)?.[1];
  const lastLine = token.raw.split("\n").pop();
  if (!marker || !lastLine || lastLine.length >= marker.length || lastLine !== marker[0]?.repeat(lastLine.length)) {
    return;
  }
  token.text = token.text.slice(0, -lastLine.length).replace(/\n$/, "");
}
var markdownParser = new Marked();
markdownParser.setOptions({
  tokenizer: new StrictStrikethroughTokenizer()
});
var Markdown = class {
  text;
  paddingX;
  // Left/right padding
  paddingY;
  // Top/bottom padding
  defaultTextStyle;
  theme;
  options;
  defaultStylePrefix;
  // Cache for rendered output
  cachedText;
  cachedWidth;
  cachedLines;
  constructor(text, paddingX, paddingY, theme, defaultTextStyle, options) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.theme = theme;
    this.defaultTextStyle = defaultTextStyle;
    this.options = options ? { ...options } : {};
  }
  setText(text) {
    this.text = text;
    this.invalidate();
  }
  invalidate() {
    this.cachedText = void 0;
    this.cachedWidth = void 0;
    this.cachedLines = void 0;
  }
  render(width) {
    if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const text = this.options.transform?.(this.text, contentWidth) ?? this.text;
    if (!text || text.trim() === "") {
      const result2 = [];
      this.cachedText = this.text;
      this.cachedWidth = width;
      this.cachedLines = result2;
      return result2;
    }
    const normalizedText = text.replace(/\t/g, "   ");
    const tokens = markdownParser.lexer(normalizedText);
    trimPartialClosingFences(tokens);
    const renderedLines = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const nextToken = tokens[i + 1];
      const tokenLines = this.renderToken(token, contentWidth, nextToken?.type);
      for (const tokenLine of tokenLines) {
        renderedLines.push(tokenLine);
      }
    }
    const wrappedLines = [];
    for (const line of renderedLines) {
      if (isImageLine(line)) {
        wrappedLines.push(line);
      } else {
        for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) {
          wrappedLines.push(wrappedLine);
        }
      }
    }
    const leftMargin = " ".repeat(this.paddingX);
    const rightMargin = " ".repeat(this.paddingX);
    const bgFn = this.defaultTextStyle?.bgColor;
    const contentLines = [];
    for (const line of wrappedLines) {
      if (isImageLine(line)) {
        contentLines.push(line);
        continue;
      }
      const lineWithMargins = leftMargin + line + rightMargin;
      if (bgFn) {
        contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
      } else {
        const visibleLen = visibleWidth(lineWithMargins);
        const paddingNeeded = Math.max(0, width - visibleLen);
        contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
      }
    }
    const emptyLine = " ".repeat(width);
    const emptyLines = [];
    for (let i = 0; i < this.paddingY; i++) {
      const line = bgFn ? applyBackgroundToLine(emptyLine, width, bgFn) : emptyLine;
      emptyLines.push(line);
    }
    const result = emptyLines.concat(contentLines, emptyLines);
    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = result;
    return result.length > 0 ? result : [""];
  }
  /**
   * Apply default text style to a string.
   * This is the base styling applied to all text content.
   * NOTE: Background color is NOT applied here - it's applied at the padding stage
   * to ensure it extends to the full line width.
   */
  applyDefaultStyle(text) {
    if (!this.defaultTextStyle) {
      return text;
    }
    let styled = text;
    if (this.defaultTextStyle.color) {
      styled = this.defaultTextStyle.color(styled);
    }
    if (this.defaultTextStyle.bold) {
      styled = this.theme.bold(styled);
    }
    if (this.defaultTextStyle.italic) {
      styled = this.theme.italic(styled);
    }
    if (this.defaultTextStyle.strikethrough) {
      styled = this.theme.strikethrough(styled);
    }
    if (this.defaultTextStyle.underline) {
      styled = this.theme.underline(styled);
    }
    return styled;
  }
  getDefaultStylePrefix() {
    if (!this.defaultTextStyle) {
      return "";
    }
    if (this.defaultStylePrefix !== void 0) {
      return this.defaultStylePrefix;
    }
    const sentinel = "\0";
    let styled = sentinel;
    if (this.defaultTextStyle.color) {
      styled = this.defaultTextStyle.color(styled);
    }
    if (this.defaultTextStyle.bold) {
      styled = this.theme.bold(styled);
    }
    if (this.defaultTextStyle.italic) {
      styled = this.theme.italic(styled);
    }
    if (this.defaultTextStyle.strikethrough) {
      styled = this.theme.strikethrough(styled);
    }
    if (this.defaultTextStyle.underline) {
      styled = this.theme.underline(styled);
    }
    const sentinelIndex = styled.indexOf(sentinel);
    this.defaultStylePrefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
    return this.defaultStylePrefix;
  }
  getStylePrefix(styleFn) {
    const sentinel = "\0";
    const styled = styleFn(sentinel);
    const sentinelIndex = styled.indexOf(sentinel);
    return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
  }
  getDefaultInlineStyleContext() {
    return {
      applyText: (text) => this.applyDefaultStyle(text),
      stylePrefix: this.getDefaultStylePrefix()
    };
  }
  renderToken(token, width, nextTokenType, styleContext) {
    const lines = [];
    switch (token.type) {
      case "heading": {
        const headingLevel = token.depth;
        const headingPrefix = `${"#".repeat(headingLevel)} `;
        let headingStyleFn;
        if (headingLevel === 1) {
          headingStyleFn = (text) => this.theme.heading(this.theme.bold(this.theme.underline(text)));
        } else {
          headingStyleFn = (text) => this.theme.heading(this.theme.bold(text));
        }
        const headingStyleContext = {
          applyText: headingStyleFn,
          stylePrefix: this.getStylePrefix(headingStyleFn)
        };
        const headingText = this.renderInlineTokens(token.tokens || [], headingStyleContext);
        const styledHeading = headingLevel >= 3 ? headingStyleFn(headingPrefix) + headingText : headingText;
        lines.push(styledHeading);
        if (nextTokenType && nextTokenType !== "space") {
          lines.push("");
        }
        break;
      }
      case "paragraph": {
        const paragraphText = this.renderInlineTokens(token.tokens || [], styleContext);
        lines.push(paragraphText);
        if (nextTokenType && nextTokenType !== "list" && nextTokenType !== "space") {
          lines.push("");
        }
        break;
      }
      case "text":
        lines.push(this.renderInlineTokens([token], styleContext));
        break;
      case "code": {
        const indent = this.theme.codeBlockIndent ?? "  ";
        lines.push(this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`));
        if (this.theme.highlightCode) {
          const highlightedLines = this.theme.highlightCode(token.text, token.lang);
          for (const hlLine of highlightedLines) {
            lines.push(`${indent}${hlLine}`);
          }
        } else {
          const codeLines = token.text.split("\n");
          for (const codeLine of codeLines) {
            lines.push(`${indent}${this.theme.codeBlock(codeLine)}`);
          }
        }
        lines.push(this.theme.codeBlockBorder("```"));
        if (nextTokenType && nextTokenType !== "space") {
          lines.push("");
        }
        break;
      }
      case "list": {
        const listLines = this.renderList(token, 0, width, styleContext);
        lines.push(...listLines);
        break;
      }
      case "table": {
        const tableLines = this.renderTable(token, width, nextTokenType, styleContext);
        lines.push(...tableLines);
        break;
      }
      case "blockquote": {
        const quoteStyle = (text) => this.theme.quote(this.theme.italic(text));
        const quoteStylePrefix = this.getStylePrefix(quoteStyle);
        const applyQuoteStyle = (line) => {
          if (!quoteStylePrefix) {
            return quoteStyle(line);
          }
          const lineWithReappliedStyle = line.replace(/\x1b\[0m/g, `\x1B[0m${quoteStylePrefix}`);
          return quoteStyle(lineWithReappliedStyle);
        };
        const quoteContentWidth = Math.max(1, width - 2);
        const quoteInlineStyleContext = {
          applyText: (text) => text,
          stylePrefix: quoteStylePrefix
        };
        const quoteTokens = token.tokens || [];
        const renderedQuoteLines = [];
        for (let i = 0; i < quoteTokens.length; i++) {
          const quoteToken = quoteTokens[i];
          const nextQuoteToken = quoteTokens[i + 1];
          renderedQuoteLines.push(
            ...this.renderToken(quoteToken, quoteContentWidth, nextQuoteToken?.type, quoteInlineStyleContext)
          );
        }
        while (renderedQuoteLines.length > 0 && renderedQuoteLines[renderedQuoteLines.length - 1] === "") {
          renderedQuoteLines.pop();
        }
        for (const quoteLine of renderedQuoteLines) {
          const styledLine = applyQuoteStyle(quoteLine);
          const wrappedLines = wrapTextWithAnsi(styledLine, quoteContentWidth);
          for (const wrappedLine of wrappedLines) {
            lines.push(this.theme.quoteBorder("\u2502 ") + wrappedLine);
          }
        }
        if (nextTokenType && nextTokenType !== "space") {
          lines.push("");
        }
        break;
      }
      case "hr":
        lines.push(this.theme.hr("\u2500".repeat(Math.min(width, 80))));
        if (nextTokenType && nextTokenType !== "space") {
          lines.push("");
        }
        break;
      case "html":
        if ("raw" in token && typeof token.raw === "string") {
          lines.push(this.applyDefaultStyle(token.raw.trim()));
        }
        break;
      case "space":
        lines.push("");
        break;
      default:
        if ("text" in token && typeof token.text === "string") {
          lines.push(token.text);
        }
    }
    return lines;
  }
  renderInlineTokens(tokens, styleContext) {
    let result = "";
    const resolvedStyleContext = styleContext ?? this.getDefaultInlineStyleContext();
    const { applyText, stylePrefix } = resolvedStyleContext;
    const applyTextWithNewlines = (text) => {
      const segments = text.split("\n");
      return segments.map((segment) => applyText(segment)).join("\n");
    };
    for (const token of tokens) {
      switch (token.type) {
        case "escape":
          result += applyTextWithNewlines(this.options.preserveBackslashEscapes ? token.raw : token.text);
          break;
        case "text":
          if (token.tokens && token.tokens.length > 0) {
            result += this.renderInlineTokens(token.tokens, resolvedStyleContext);
          } else {
            result += applyTextWithNewlines(token.text);
          }
          break;
        case "paragraph":
          result += this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
          break;
        case "strong": {
          const boldContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
          result += this.theme.bold(boldContent) + stylePrefix;
          break;
        }
        case "em": {
          const italicContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
          result += this.theme.italic(italicContent) + stylePrefix;
          break;
        }
        case "codespan":
          result += this.theme.code(token.text) + stylePrefix;
          break;
        case "link": {
          const linkText = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
          const styledLink = this.theme.link(this.theme.underline(linkText));
          if (getCapabilities().hyperlinks) {
            result += hyperlink(styledLink, token.href) + stylePrefix;
          } else {
            const hrefForComparison = token.href.startsWith("mailto:") ? token.href.slice(7) : token.href;
            if (token.text === token.href || token.text === hrefForComparison) {
              result += styledLink + stylePrefix;
            } else {
              result += styledLink + this.theme.linkUrl(` (${token.href})`) + stylePrefix;
            }
          }
          break;
        }
        case "br":
          result += "\n";
          break;
        case "del": {
          const delContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
          result += this.theme.strikethrough(delContent) + stylePrefix;
          break;
        }
        case "html":
          if ("raw" in token && typeof token.raw === "string") {
            result += applyTextWithNewlines(token.raw);
          }
          break;
        default:
          if ("text" in token && typeof token.text === "string") {
            result += applyTextWithNewlines(token.text);
          }
      }
    }
    while (stylePrefix && result.endsWith(stylePrefix)) {
      result = result.slice(0, -stylePrefix.length);
    }
    return result;
  }
  getOrderedListMarker(item) {
    const match = /^(?: {0,3})(\d{1,9}[.)])[ \t]+/.exec(item.raw);
    return match ? `${match[1]} ` : void 0;
  }
  getUnorderedListMarker(item) {
    const match = /^(?: {0,3})([-+*])(?:[ \t]+|(?=\r?\n|$))/.exec(item.raw);
    return match ? `${match[1]} ` : void 0;
  }
  /**
   * Render a list with proper nesting support
   */
  renderList(token, depth, width, styleContext) {
    const lines = [];
    const indent = "    ".repeat(depth);
    const startNumber = typeof token.start === "number" ? token.start : 1;
    for (let i = 0; i < token.items.length; i++) {
      const item = token.items[i];
      const isLastItem = i === token.items.length - 1;
      const bullet = token.ordered ? this.options.preserveOrderedListMarkers ? this.getOrderedListMarker(item) ?? `${startNumber + i}. ` : `${startNumber + i}. ` : this.options.preserveOrderedListMarkers ? this.getUnorderedListMarker(item) ?? "- " : "- ";
      const taskMarker = item.task ? `[${item.checked ? "x" : " "}] ` : "";
      const marker = bullet + taskMarker;
      const firstPrefix = indent + this.theme.listBullet(marker);
      const continuationPrefix = indent + " ".repeat(visibleWidth(marker));
      const itemWidth = Math.max(1, width - visibleWidth(firstPrefix));
      let renderedAnyLine = false;
      for (const itemToken of item.tokens) {
        if (itemToken.type === "list") {
          lines.push(...this.renderList(itemToken, depth + 1, width, styleContext));
          renderedAnyLine = true;
          continue;
        }
        const itemLines = this.renderToken(itemToken, itemWidth, void 0, styleContext);
        for (const line of itemLines) {
          for (const wrappedLine of wrapTextWithAnsi(line, itemWidth)) {
            const linePrefix = renderedAnyLine ? continuationPrefix : firstPrefix;
            lines.push(linePrefix + wrappedLine);
            renderedAnyLine = true;
          }
        }
      }
      if (!renderedAnyLine) {
        lines.push(firstPrefix);
      }
      if (token.loose && !isLastItem) {
        lines.push("");
      }
    }
    return lines;
  }
  /**
   * Get the visible width of the longest word in a string.
   */
  getLongestWordWidth(text, maxWidth) {
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    let longest = 0;
    for (const word of words) {
      longest = Math.max(longest, visibleWidth(word));
    }
    if (maxWidth === void 0) {
      return longest;
    }
    return Math.min(longest, maxWidth);
  }
  /**
   * Wrap a table cell to fit into a column.
   *
   * Delegates to wrapTextWithAnsi() so ANSI codes + long tokens are handled
   * consistently with the rest of the renderer.
   */
  wrapCellText(text, maxWidth) {
    return wrapTextWithAnsi(text, Math.max(1, maxWidth));
  }
  /**
   * Render a table with width-aware cell wrapping.
   * Cells that don't fit are wrapped to multiple lines.
   */
  renderTable(token, availableWidth, nextTokenType, styleContext) {
    const lines = [];
    const numCols = token.header.length;
    if (numCols === 0) {
      return lines;
    }
    const borderOverhead = 3 * numCols + 1;
    const availableForCells = availableWidth - borderOverhead;
    if (availableForCells < numCols) {
      const fallbackLines = token.raw ? wrapTextWithAnsi(token.raw, availableWidth) : [];
      if (nextTokenType && nextTokenType !== "space") {
        fallbackLines.push("");
      }
      return fallbackLines;
    }
    const maxUnbrokenWordWidth = 30;
    const naturalWidths = [];
    const minWordWidths = [];
    for (let i = 0; i < numCols; i++) {
      const headerText = this.renderInlineTokens(token.header[i].tokens || [], styleContext);
      naturalWidths[i] = visibleWidth(headerText);
      minWordWidths[i] = Math.max(1, this.getLongestWordWidth(headerText, maxUnbrokenWordWidth));
    }
    for (const row of token.rows) {
      for (let i = 0; i < row.length; i++) {
        const cellText = this.renderInlineTokens(row[i].tokens || [], styleContext);
        naturalWidths[i] = Math.max(naturalWidths[i] || 0, visibleWidth(cellText));
        minWordWidths[i] = Math.max(
          minWordWidths[i] || 1,
          this.getLongestWordWidth(cellText, maxUnbrokenWordWidth)
        );
      }
    }
    let minColumnWidths = minWordWidths;
    let minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
    if (minCellsWidth > availableForCells) {
      minColumnWidths = new Array(numCols).fill(1);
      const remaining = availableForCells - numCols;
      if (remaining > 0) {
        const totalWeight = minWordWidths.reduce((total, width) => total + Math.max(0, width - 1), 0);
        const growth = minWordWidths.map((width) => {
          const weight = Math.max(0, width - 1);
          return totalWeight > 0 ? Math.floor(weight / totalWeight * remaining) : 0;
        });
        for (let i = 0; i < numCols; i++) {
          minColumnWidths[i] += growth[i] ?? 0;
        }
        const allocated = growth.reduce((total, width) => total + width, 0);
        let leftover = remaining - allocated;
        for (let i = 0; leftover > 0 && i < numCols; i++) {
          minColumnWidths[i]++;
          leftover--;
        }
      }
      minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
    }
    const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
    let columnWidths;
    if (totalNaturalWidth <= availableWidth) {
      columnWidths = naturalWidths.map((width, index) => Math.max(width, minColumnWidths[index]));
    } else {
      const totalGrowPotential = naturalWidths.reduce((total, width, index) => {
        return total + Math.max(0, width - minColumnWidths[index]);
      }, 0);
      const extraWidth = Math.max(0, availableForCells - minCellsWidth);
      columnWidths = minColumnWidths.map((minWidth, index) => {
        const naturalWidth = naturalWidths[index];
        const minWidthDelta = Math.max(0, naturalWidth - minWidth);
        let grow = 0;
        if (totalGrowPotential > 0) {
          grow = Math.floor(minWidthDelta / totalGrowPotential * extraWidth);
        }
        return minWidth + grow;
      });
      const allocated = columnWidths.reduce((a, b) => a + b, 0);
      let remaining = availableForCells - allocated;
      while (remaining > 0) {
        let grew = false;
        for (let i = 0; i < numCols && remaining > 0; i++) {
          if (columnWidths[i] < naturalWidths[i]) {
            columnWidths[i]++;
            remaining--;
            grew = true;
          }
        }
        if (!grew) {
          break;
        }
      }
    }
    const topBorderCells = columnWidths.map((w) => "\u2500".repeat(w));
    lines.push(`\u250C\u2500${topBorderCells.join("\u2500\u252C\u2500")}\u2500\u2510`);
    const headerCellLines = token.header.map((cell, i) => {
      const text = this.renderInlineTokens(cell.tokens || [], styleContext);
      return this.wrapCellText(text, columnWidths[i]);
    });
    const headerLineCount = Math.max(...headerCellLines.map((c) => c.length));
    for (let lineIdx = 0; lineIdx < headerLineCount; lineIdx++) {
      const rowParts = headerCellLines.map((cellLines, colIdx) => {
        const text = cellLines[lineIdx] || "";
        const padded = text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
        return this.theme.bold(padded);
      });
      lines.push(`\u2502 ${rowParts.join(" \u2502 ")} \u2502`);
    }
    const separatorCells = columnWidths.map((w) => "\u2500".repeat(w));
    const separatorLine = `\u251C\u2500${separatorCells.join("\u2500\u253C\u2500")}\u2500\u2524`;
    lines.push(separatorLine);
    for (let rowIndex = 0; rowIndex < token.rows.length; rowIndex++) {
      const row = token.rows[rowIndex];
      const rowCellLines = row.map((cell, i) => {
        const text = this.renderInlineTokens(cell.tokens || [], styleContext);
        return this.wrapCellText(text, columnWidths[i]);
      });
      const rowLineCount = Math.max(...rowCellLines.map((c) => c.length));
      for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
        const rowParts = rowCellLines.map((cellLines, colIdx) => {
          const text = cellLines[lineIdx] || "";
          return text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
        });
        lines.push(`\u2502 ${rowParts.join(" \u2502 ")} \u2502`);
      }
      if (rowIndex < token.rows.length - 1) {
        lines.push(separatorLine);
      }
    }
    const bottomBorderCells = columnWidths.map((w) => "\u2500".repeat(w));
    lines.push(`\u2514\u2500${bottomBorderCells.join("\u2500\u2534\u2500")}\u2500\u2518`);
    if (nextTokenType && nextTokenType !== "space") {
      lines.push("");
    }
    return lines;
  }
};

// tui/src/components/settings-list.ts
var SettingsList = class {
  items;
  filteredItems;
  theme;
  selectedIndex = 0;
  maxVisible;
  onChange;
  onCancel;
  searchInput;
  searchEnabled;
  // Submenu state
  submenuComponent = null;
  submenuItemIndex = null;
  constructor(items, maxVisible, theme, onChange, onCancel, options = {}) {
    this.items = items;
    this.filteredItems = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.onChange = onChange;
    this.onCancel = onCancel;
    this.searchEnabled = options.enableSearch ?? false;
    if (this.searchEnabled) {
      this.searchInput = new Input();
    }
  }
  /** Update an item's currentValue */
  updateValue(id, newValue) {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.currentValue = newValue;
    }
  }
  invalidate() {
    this.submenuComponent?.invalidate?.();
  }
  render(width) {
    if (this.submenuComponent) {
      return this.submenuComponent.render(width);
    }
    return this.renderMainList(width);
  }
  renderMainList(width) {
    const lines = [];
    if (this.searchEnabled && this.searchInput) {
      lines.push(...this.searchInput.render(width));
      lines.push("");
    }
    if (this.items.length === 0) {
      lines.push(this.theme.hint("  No settings available"));
      if (this.searchEnabled) {
        this.addHintLine(lines, width);
      }
      return lines;
    }
    const displayItems = this.searchEnabled ? this.filteredItems : this.items;
    if (displayItems.length === 0) {
      lines.push(truncateToWidth(this.theme.hint("  No matching settings"), width));
      this.addHintLine(lines, width);
      return lines;
    }
    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), displayItems.length - this.maxVisible)
    );
    const endIndex = Math.min(startIndex + this.maxVisible, displayItems.length);
    const maxLabelWidth = Math.min(30, Math.max(...this.items.map((item) => visibleWidth(item.label))));
    for (let i = startIndex; i < endIndex; i++) {
      const item = displayItems[i];
      if (!item) continue;
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? this.theme.cursor : "  ";
      const prefixWidth = visibleWidth(prefix);
      const labelPadded = item.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(item.label)));
      const labelText = this.theme.label(labelPadded, isSelected);
      const separator = "  ";
      const usedWidth = prefixWidth + maxLabelWidth + visibleWidth(separator);
      const valueMaxWidth = width - usedWidth - 2;
      const valueText = this.theme.value(truncateToWidth(item.currentValue, valueMaxWidth, ""), isSelected);
      lines.push(truncateToWidth(prefix + labelText + separator + valueText, width));
    }
    if (startIndex > 0 || endIndex < displayItems.length) {
      const scrollText = `  (${this.selectedIndex + 1}/${displayItems.length})`;
      lines.push(this.theme.hint(truncateToWidth(scrollText, width - 2, "")));
    }
    const selectedItem = displayItems[this.selectedIndex];
    if (selectedItem?.description) {
      lines.push("");
      const wrappedDesc = wrapTextWithAnsi(selectedItem.description, width - 4);
      for (const line of wrappedDesc) {
        lines.push(this.theme.description(`  ${line}`));
      }
    }
    this.addHintLine(lines, width);
    return lines;
  }
  handleInput(data) {
    if (this.submenuComponent) {
      this.submenuComponent.handleInput?.(data);
      return;
    }
    const kb = getKeybindings();
    const displayItems = this.searchEnabled ? this.filteredItems : this.items;
    if (kb.matches(data, "tui.select.up")) {
      if (displayItems.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0 ? displayItems.length - 1 : this.selectedIndex - 1;
    } else if (kb.matches(data, "tui.select.down")) {
      if (displayItems.length === 0) return;
      this.selectedIndex = this.selectedIndex === displayItems.length - 1 ? 0 : this.selectedIndex + 1;
    } else if (kb.matches(data, "tui.select.confirm") || data === " ") {
      this.activateItem();
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel();
    } else if (this.searchEnabled && this.searchInput) {
      const sanitized = data.replace(/ /g, "");
      if (!sanitized) {
        return;
      }
      this.searchInput.handleInput(sanitized);
      this.applyFilter(this.searchInput.getValue());
    }
  }
  activateItem() {
    const item = this.searchEnabled ? this.filteredItems[this.selectedIndex] : this.items[this.selectedIndex];
    if (!item) return;
    if (item.submenu) {
      this.submenuItemIndex = this.selectedIndex;
      this.submenuComponent = item.submenu(item.currentValue, (selectedValue) => {
        if (selectedValue !== void 0) {
          item.currentValue = selectedValue;
          this.onChange(item.id, selectedValue);
        }
        this.closeSubmenu();
      });
    } else if (item.values && item.values.length > 0) {
      const currentIndex = item.values.indexOf(item.currentValue);
      const nextIndex = (currentIndex + 1) % item.values.length;
      const newValue = item.values[nextIndex];
      item.currentValue = newValue;
      this.onChange(item.id, newValue);
    }
  }
  closeSubmenu() {
    this.submenuComponent = null;
    if (this.submenuItemIndex !== null) {
      this.selectedIndex = this.submenuItemIndex;
      this.submenuItemIndex = null;
    }
  }
  applyFilter(query) {
    this.filteredItems = fuzzyFilter(this.items, query, (item) => item.label);
    this.selectedIndex = 0;
  }
  addHintLine(lines, width) {
    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.hint(
          this.searchEnabled ? "  Type to search \xB7 Enter/Space to change \xB7 Esc to cancel" : "  Enter/Space to change \xB7 Esc to cancel"
        ),
        width
      )
    );
  }
};

// tui/src/components/spacer.ts
var Spacer = class {
  lines;
  constructor(lines = 1) {
    this.lines = lines;
  }
  setLines(lines) {
    this.lines = lines;
  }
  invalidate() {
  }
  render(_width) {
    const result = [];
    for (let i = 0; i < this.lines; i++) {
      result.push("");
    }
    return result;
  }
};

// tui/src/components/truncated-text.ts
var TruncatedText = class {
  text;
  paddingX;
  paddingY;
  constructor(text, paddingX = 0, paddingY = 0) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
  }
  invalidate() {
  }
  render(width) {
    const result = [];
    const emptyLine = " ".repeat(width);
    for (let i = 0; i < this.paddingY; i++) {
      result.push(emptyLine);
    }
    const availableWidth = Math.max(1, width - this.paddingX * 2);
    let singleLineText = this.text;
    const newlineIndex = this.text.indexOf("\n");
    if (newlineIndex !== -1) {
      singleLineText = this.text.substring(0, newlineIndex);
    }
    const displayText = truncateToWidth(singleLineText, availableWidth);
    const leftPadding = " ".repeat(this.paddingX);
    const rightPadding = " ".repeat(this.paddingX);
    const lineWithPadding = leftPadding + displayText + rightPadding;
    const lineVisibleWidth = visibleWidth(lineWithPadding);
    const paddingNeeded = Math.max(0, width - lineVisibleWidth);
    const finalLine = lineWithPadding + " ".repeat(paddingNeeded);
    result.push(finalLine);
    for (let i = 0; i < this.paddingY; i++) {
      result.push(emptyLine);
    }
    return result;
  }
};

// tui/src/stdin-buffer.ts
import { EventEmitter } from "events";
var ESC = "\x1B";
var BRACKETED_PASTE_START = "\x1B[200~";
var BRACKETED_PASTE_END = "\x1B[201~";
function isCompleteSequence(data) {
  if (!data.startsWith(ESC)) {
    return "not-escape";
  }
  if (data.length === 1) {
    return "incomplete";
  }
  const afterEsc = data.slice(1);
  if (afterEsc.startsWith("[")) {
    if (afterEsc.startsWith("[M")) {
      return data.length >= 6 ? "complete" : "incomplete";
    }
    return isCompleteCsiSequence(data);
  }
  if (afterEsc.startsWith("]")) {
    return isCompleteOscSequence(data);
  }
  if (afterEsc.startsWith("P")) {
    return isCompleteDcsSequence(data);
  }
  if (afterEsc.startsWith("_")) {
    return isCompleteApcSequence(data);
  }
  if (afterEsc.startsWith("O")) {
    return afterEsc.length >= 2 ? "complete" : "incomplete";
  }
  if (afterEsc.length === 1) {
    return "complete";
  }
  return "complete";
}
function isCompleteCsiSequence(data) {
  if (!data.startsWith(`${ESC}[`)) {
    return "complete";
  }
  if (data.length < 3) {
    return "incomplete";
  }
  const payload = data.slice(2);
  const lastChar = payload[payload.length - 1];
  const lastCharCode = lastChar.charCodeAt(0);
  if (lastCharCode >= 64 && lastCharCode <= 126) {
    if (payload.startsWith("<")) {
      const mouseMatch = /^<\d+;\d+;\d+[Mm]$/.test(payload);
      if (mouseMatch) {
        return "complete";
      }
      if (lastChar === "M" || lastChar === "m") {
        const parts = payload.slice(1, -1).split(";");
        if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
          return "complete";
        }
      }
      return "incomplete";
    }
    return "complete";
  }
  return "incomplete";
}
function isCompleteOscSequence(data) {
  if (!data.startsWith(`${ESC}]`)) {
    return "complete";
  }
  if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) {
    return "complete";
  }
  return "incomplete";
}
function isCompleteDcsSequence(data) {
  if (!data.startsWith(`${ESC}P`)) {
    return "complete";
  }
  if (data.endsWith(`${ESC}\\`)) {
    return "complete";
  }
  return "incomplete";
}
function isCompleteApcSequence(data) {
  if (!data.startsWith(`${ESC}_`)) {
    return "complete";
  }
  if (data.endsWith(`${ESC}\\`)) {
    return "complete";
  }
  return "incomplete";
}
function parseUnmodifiedKittyPrintableCodepoint(sequence) {
  const match = sequence.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?u$/);
  if (!match) return void 0;
  const codepoint = parseInt(match[1], 10);
  return codepoint >= 32 ? codepoint : void 0;
}
function extractCompleteSequences(buffer) {
  const sequences = [];
  let pos = 0;
  while (pos < buffer.length) {
    const remaining = buffer.slice(pos);
    if (remaining.startsWith(ESC)) {
      let seqEnd = 1;
      while (seqEnd <= remaining.length) {
        const candidate = remaining.slice(0, seqEnd);
        const status = isCompleteSequence(candidate);
        if (status === "complete") {
          if (candidate === "\x1B\x1B") {
            const nextChar = remaining[seqEnd];
            if (nextChar === "[" || // CSI
            nextChar === "]" || // OSC
            nextChar === "O" || // SS3
            nextChar === "P" || // DCS
            nextChar === "_") {
              sequences.push(ESC);
              pos += 1;
              break;
            }
          }
          sequences.push(candidate);
          pos += seqEnd;
          break;
        } else if (status === "incomplete") {
          seqEnd++;
        } else {
          sequences.push(candidate);
          pos += seqEnd;
          break;
        }
      }
      if (seqEnd > remaining.length) {
        return { sequences, remainder: remaining };
      }
    } else {
      sequences.push(remaining[0]);
      pos++;
    }
  }
  return { sequences, remainder: "" };
}
var StdinBuffer = class extends EventEmitter {
  buffer = "";
  timeout = null;
  timeoutMs;
  pasteMode = false;
  pasteBuffer = "";
  pendingKittyPrintableCodepoint;
  constructor(options = {}) {
    super();
    this.timeoutMs = options.timeout ?? 10;
  }
  process(data) {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    let str;
    if (Buffer.isBuffer(data)) {
      if (data.length === 1 && data[0] > 127) {
        const byte = data[0] - 128;
        str = `\x1B${String.fromCharCode(byte)}`;
      } else {
        str = data.toString();
      }
    } else {
      str = data;
    }
    if (str.length === 0 && this.buffer.length === 0) {
      this.emitDataSequence("");
      return;
    }
    this.buffer += str;
    if (this.pasteMode) {
      this.pasteBuffer += this.buffer;
      this.buffer = "";
      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
      if (endIndex !== -1) {
        const pastedContent = this.pasteBuffer.slice(0, endIndex);
        const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
        this.pasteMode = false;
        this.pasteBuffer = "";
        this.pendingKittyPrintableCodepoint = void 0;
        this.emit("paste", pastedContent);
        if (remaining.length > 0) {
          this.process(remaining);
        }
      }
      return;
    }
    const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START);
    if (startIndex !== -1) {
      if (startIndex > 0) {
        const beforePaste = this.buffer.slice(0, startIndex);
        const result2 = extractCompleteSequences(beforePaste);
        for (const sequence of result2.sequences) {
          this.emitDataSequence(sequence);
        }
      }
      this.pendingKittyPrintableCodepoint = void 0;
      this.buffer = this.buffer.slice(startIndex + BRACKETED_PASTE_START.length);
      this.pasteMode = true;
      this.pasteBuffer = this.buffer;
      this.buffer = "";
      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
      if (endIndex !== -1) {
        const pastedContent = this.pasteBuffer.slice(0, endIndex);
        const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
        this.pasteMode = false;
        this.pasteBuffer = "";
        this.pendingKittyPrintableCodepoint = void 0;
        this.emit("paste", pastedContent);
        if (remaining.length > 0) {
          this.process(remaining);
        }
      }
      return;
    }
    const result = extractCompleteSequences(this.buffer);
    this.buffer = result.remainder;
    for (const sequence of result.sequences) {
      this.emitDataSequence(sequence);
    }
    if (this.buffer.length > 0) {
      this.timeout = setTimeout(() => {
        const flushed = this.flush();
        for (const sequence of flushed) {
          this.emitDataSequence(sequence);
        }
      }, this.timeoutMs);
    }
  }
  emitDataSequence(sequence) {
    const rawCodepoint = sequence.length === 1 ? sequence.codePointAt(0) : void 0;
    if (rawCodepoint !== void 0 && rawCodepoint === this.pendingKittyPrintableCodepoint) {
      this.pendingKittyPrintableCodepoint = void 0;
      return;
    }
    this.pendingKittyPrintableCodepoint = parseUnmodifiedKittyPrintableCodepoint(sequence);
    this.emit("data", sequence);
  }
  flush() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.buffer.length === 0) {
      return [];
    }
    const sequences = [this.buffer];
    this.buffer = "";
    this.pendingKittyPrintableCodepoint = void 0;
    return sequences;
  }
  clear() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.buffer = "";
    this.pasteMode = false;
    this.pasteBuffer = "";
    this.pendingKittyPrintableCodepoint = void 0;
  }
  getBuffer() {
    return this.buffer;
  }
  destroy() {
    this.clear();
  }
};

// tui/src/TuiAltScreen.ts
var ENTER_ALT_SCREEN = "\x1B[?1049h";
var EXIT_ALT_SCREEN = "\x1B[?1049l";
var DISABLE_AUTOWRAP = "\x1B[?7l";
var ENABLE_AUTOWRAP = "\x1B[?7h";
var ENABLE_MOUSE = "\x1B[?1000h\x1B[?1002h\x1B[?1006h";
var DISABLE_MOUSE = "\x1B[?1006l\x1B[?1002l\x1B[?1000l";
var BEGIN_SYNCHRONIZED_OUTPUT = "\x1B[?2026h";
var END_SYNCHRONIZED_OUTPUT = "\x1B[?2026l";
var OSC133_ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
var TuiAltScreen = class extends TuiBase {
  previousScreen = [];
  lastDocument = [];
  previousScreenWidth = 0;
  previousScreenHeight = 0;
  scrollTop = 0;
  contentLineCount = 0;
  stickToBottom = true;
  altScreenActive = false;
  imageProtocol = null;
  savedCapabilities;
  selectionAnchor;
  selectionFocus;
  pressedUrl;
  selectionDragged = false;
  wheelScrollLines;
  mouseEnabled;
  openUrl;
  constructor(terminal, showHardwareCursor, logDirectory, options = {}) {
    super(terminal, showHardwareCursor, logDirectory);
    this.wheelScrollLines = Math.max(1, Math.floor(options.wheelScrollLines ?? 3));
    this.mouseEnabled = options.mouse ?? true;
    this.openUrl = options.openUrl;
    this.addInputListener((data) => this.handleViewportInput(data));
  }
  get viewportTop() {
    return this.scrollTop;
  }
  get isFollowingOutput() {
    return this.stickToBottom;
  }
  beforeTerminalStart() {
    this.altScreenActive = true;
    const capabilities = getCapabilities();
    this.imageProtocol = capabilities.images;
    if (capabilities.images === "iterm2") {
      this.savedCapabilities = capabilities;
      setCapabilities({ ...capabilities, images: null });
      this.invalidate();
    }
    this.lastDocument = [];
    this.selectionAnchor = void 0;
    this.selectionFocus = void 0;
    this.pressedUrl = void 0;
    this.selectionDragged = false;
    this.resetRenderState();
    this.terminal.write(
      `${ENTER_ALT_SCREEN}${DISABLE_AUTOWRAP}${this.mouseEnabled ? ENABLE_MOUSE : ""}\x1B[2J\x1B[H\x1B[?25l`
    );
  }
  beforeTerminalStop() {
    if (!this.altScreenActive) return;
    this.terminal.write(
      `${BEGIN_SYNCHRONIZED_OUTPUT}${this.deleteKittyImages()}${this.mouseEnabled ? DISABLE_MOUSE : ""}${ENABLE_AUTOWRAP}${END_SYNCHRONIZED_OUTPUT}`
    );
  }
  afterTerminalStop() {
    if (!this.altScreenActive) return;
    this.altScreenActive = false;
    let buffer = `${BEGIN_SYNCHRONIZED_OUTPUT}${EXIT_ALT_SCREEN}${DISABLE_AUTOWRAP}`;
    for (let row = 0; row < this.lastDocument.length; row++) {
      if (row > 0) buffer += "\r\n";
      buffer += `\r\x1B[2K${this.lastDocument[row] ?? ""}`;
    }
    buffer += `\x1B[0m${ENABLE_AUTOWRAP}\r
\x1B[?25h${END_SYNCHRONIZED_OUTPUT}`;
    this.terminal.write(buffer);
    if (this.savedCapabilities) {
      setCapabilities(this.savedCapabilities);
      this.savedCapabilities = void 0;
    }
  }
  deleteKittyImages() {
    return this.imageProtocol === "kitty" ? deleteAllKittyImages() : "";
  }
  resetRenderState() {
    this.previousScreen = [];
    this.previousScreenWidth = 0;
    this.previousScreenHeight = 0;
  }
  scrollBy(lines) {
    if (lines === 0) return;
    const height = Math.max(1, this.terminal.rows);
    const maxScrollTop = Math.max(0, this.contentLineCount - height);
    const currentTop = this.stickToBottom ? maxScrollTop : this.scrollTop;
    this.scrollTop = Math.max(0, Math.min(maxScrollTop, currentTop + lines));
    this.stickToBottom = this.scrollTop === maxScrollTop;
    this.requestRender();
  }
  scrollToTop() {
    this.scrollTop = 0;
    this.stickToBottom = this.contentLineCount <= this.terminal.rows;
    this.requestRender();
  }
  scrollToBottom() {
    this.stickToBottom = true;
    this.scrollTop = Math.max(0, this.contentLineCount - this.terminal.rows);
    this.requestRender();
  }
  handleViewportInput(data) {
    const wheelDirection = this.parseWheelDirection(data);
    if (wheelDirection !== void 0) {
      this.scrollBy(wheelDirection * this.wheelScrollLines);
      return { consume: true };
    }
    const mouseEvent = this.parseSgrMouseEvent(data);
    if (mouseEvent) {
      this.handleSelectionMouseEvent(mouseEvent);
      return { consume: true };
    }
    if (this.isMouseSequence(data)) return { consume: true };
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.altScreen.pageUp")) {
      this.scrollBy(-Math.max(1, this.terminal.rows - 1));
      return { consume: true };
    }
    if (keybindings.matches(data, "tui.altScreen.pageDown")) {
      this.scrollBy(Math.max(1, this.terminal.rows - 1));
      return { consume: true };
    }
    if (keybindings.matches(data, "tui.altScreen.top")) {
      this.scrollToTop();
      return { consume: true };
    }
    if (keybindings.matches(data, "tui.altScreen.bottom")) {
      this.scrollToBottom();
      return { consume: true };
    }
    return void 0;
  }
  parseWheelDirection(data) {
    const sgr = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data);
    if (sgr) {
      const button = Number.parseInt(sgr[1], 10);
      if ((button & 64) === 0) return void 0;
      const direction = button & 3;
      if (direction === 0) return -1;
      if (direction === 1) return 1;
      return void 0;
    }
    if (data.length === 6 && data.startsWith("\x1B[M")) {
      const button = data.charCodeAt(3) - 32;
      if ((button & 64) === 0) return void 0;
      const direction = button & 3;
      if (direction === 0) return -1;
      if (direction === 1) return 1;
      return void 0;
    }
    return void 0;
  }
  parseSgrMouseEvent(data) {
    const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
    if (!match) return void 0;
    return {
      button: Number.parseInt(match[1], 10),
      x: Number.parseInt(match[2], 10) - 1,
      y: Number.parseInt(match[3], 10) - 1,
      release: match[4] === "m"
    };
  }
  handleSelectionMouseEvent(event) {
    if ((event.button & 3) !== 0) return;
    const viewportRow = Math.max(0, Math.min(this.terminal.rows - 1, event.y));
    const point = {
      row: this.scrollTop + viewportRow,
      col: Math.max(0, Math.min(this.terminal.columns - 1, event.x))
    };
    if (event.release) {
      if (!this.selectionAnchor) return;
      this.selectionFocus = point;
      const clickedUrl = !this.selectionDragged && this.selectionAnchor.row === point.row && this.selectionAnchor.col === point.col ? this.pressedUrl : void 0;
      this.pressedUrl = void 0;
      if (clickedUrl && this.openUrl) {
        this.selectionAnchor = void 0;
        this.selectionFocus = void 0;
        try {
          this.openUrl(clickedUrl);
        } catch {
        }
        this.requestRender();
        return;
      }
      this.copySelectionToClipboard();
      this.requestRender();
      return;
    }
    if ((event.button & 32) !== 0) {
      if (!this.selectionAnchor) return;
      this.selectionDragged = true;
      this.pressedUrl = void 0;
      this.selectionFocus = point;
      this.requestRender();
      return;
    }
    this.selectionAnchor = point;
    this.selectionFocus = point;
    this.selectionDragged = false;
    this.pressedUrl = getOsc8LinkAtColumn(this.previousScreen[viewportRow] ?? "", point.col);
    this.requestRender();
  }
  getSelectionBounds() {
    if (!this.selectionAnchor || !this.selectionFocus) return void 0;
    const anchorBeforeFocus = this.selectionAnchor.row < this.selectionFocus.row || this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col < this.selectionFocus.col;
    if (this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col === this.selectionFocus.col) {
      return void 0;
    }
    return anchorBeforeFocus ? { start: this.selectionAnchor, end: this.selectionFocus } : { start: this.selectionFocus, end: this.selectionAnchor };
  }
  getSelectionColumns(line, row, selection) {
    const lineWidth = visibleWidth(line);
    let start = 0;
    let end = lineWidth;
    if (row === selection.start.row) {
      start = getGraphemeCellRange(line, selection.start.col)?.start ?? Math.min(selection.start.col, lineWidth);
    }
    if (row === selection.end.row) {
      end = getGraphemeCellRange(line, selection.end.col)?.end ?? Math.min(selection.end.col + 1, lineWidth);
    }
    return { start, end };
  }
  copySelectionToClipboard() {
    const selection = this.getSelectionBounds();
    if (!selection) return;
    const lines = [];
    for (let row = selection.start.row; row <= selection.end.row; row++) {
      const line = this.lastDocument[row] ?? "";
      const columns = this.getSelectionColumns(line, row, selection);
      lines.push(
        stripTerminalSequences(
          sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true)
        ).trimEnd()
      );
    }
    const text = lines.join("\n");
    if (text.length === 0) return;
    this.terminal.write(`\x1B]52;c;${Buffer.from(text).toString("base64")}\x07`);
  }
  applySelection(screen) {
    const selection = this.getSelectionBounds();
    if (!selection) return screen;
    return screen.map((line, viewportRow) => {
      const row = this.scrollTop + viewportRow;
      if (row < selection.start.row || row > selection.end.row || isImageLine(line)) return line;
      const lineWidth = visibleWidth(line);
      const columns = this.getSelectionColumns(line, row, selection);
      if (columns.end <= columns.start) return line;
      const before = sliceByColumn(line, 0, columns.start, true);
      const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
      const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
      return `${before}\x1B[7m${selected}\x1B[27m${after}`;
    });
  }
  isMouseSequence(data) {
    return /^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data) || data.length === 6 && data.startsWith("\x1B[M");
  }
  doRender() {
    if (this.stopped || !this.altScreenActive) return;
    const width = Math.max(1, this.terminal.columns);
    const height = Math.max(1, this.terminal.rows);
    const contentLines = this.render(width).map((line) => line.replace(OSC133_ZONE_PREFIX, ""));
    this.contentLineCount = contentLines.length;
    this.lastDocument = this.applyLineResets(contentLines.map((line) => line.replaceAll(CURSOR_MARKER, ""))).map(
      (line) => {
        if (isImageLine(line) || visibleWidth(line) <= width) return line;
        return sliceByColumn(line, 0, width, true);
      }
    );
    const maxScrollTop = Math.max(0, contentLines.length - height);
    if (this.stickToBottom) {
      this.scrollTop = maxScrollTop;
    } else {
      this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScrollTop));
      this.stickToBottom = this.scrollTop === maxScrollTop;
    }
    let screen = contentLines.slice(this.scrollTop, this.scrollTop + height);
    if (this.scrollTop > 0) {
      for (let imageRow = this.scrollTop - 1; imageRow >= 0; imageRow--) {
        const imageLine = contentLines[imageRow] ?? "";
        const metadata = getKittyImageMetadata(imageLine);
        if (metadata) {
          const hiddenRows = this.scrollTop - imageRow;
          if (hiddenRows < metadata.rows) {
            const visibleRows = Math.min(height, metadata.rows - hiddenRows);
            screen[0] = cropKittyImageLine(imageLine, hiddenRows, visibleRows);
          }
          break;
        }
        if (imageLine !== "") break;
      }
    }
    while (screen.length < height) screen.push("");
    screen = this.compositeOverlays(screen, width, height);
    if (screen.length > height) screen = screen.slice(screen.length - height);
    screen = this.applySelection(screen);
    const cursorPos = this.extractCursorPosition(screen, height);
    screen = this.applyLineResets(screen).map((line) => {
      if (isImageLine(line) || visibleWidth(line) <= width) return line;
      return sliceByColumn(line, 0, width, true);
    });
    const fullRedraw = this.previousScreen.length === 0 || this.previousScreenWidth !== width || this.previousScreenHeight !== height;
    const imagesNeedRedraw = screen.some(
      (line, row) => line !== this.previousScreen[row] && (isImageLine(line) || isImageLine(this.previousScreen[row] ?? ""))
    );
    let buffer = BEGIN_SYNCHRONIZED_OUTPUT;
    if (fullRedraw) {
      this.fullRedrawCount += 1;
      buffer += `${this.deleteKittyImages()}\x1B[2J`;
    } else if (imagesNeedRedraw) {
      buffer += this.imageProtocol === "iterm2" ? "\x1B[2J" : this.deleteKittyImages();
    }
    for (let row = 0; row < height; row++) {
      if (!fullRedraw && !imagesNeedRedraw && screen[row] === this.previousScreen[row]) continue;
      buffer += `\x1B[${row + 1};1H\x1B[2K${screen[row] ?? ""}`;
    }
    if (cursorPos) {
      buffer += `\x1B[${cursorPos.row + 1};${Math.min(width, cursorPos.col) + 1}H`;
      buffer += this.getShowHardwareCursor() ? "\x1B[?25h" : "\x1B[?25l";
    } else {
      buffer += "\x1B[?25l";
    }
    buffer += END_SYNCHRONIZED_OUTPUT;
    this.terminal.write(buffer);
    this.previousScreen = screen;
    this.previousScreenWidth = width;
    this.previousScreenHeight = height;
  }
};

// tui/src/TuiMainScreen.ts
import * as fs from "node:fs";
import * as path2 from "node:path";
var KITTY_SEQUENCE_PREFIX = "\x1B_G";
function parseKittyImageHeader(line) {
  const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
  if (sequenceStart === -1) return void 0;
  const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
  const paramsEnd = line.indexOf(";", paramsStart);
  if (paramsEnd === -1) return void 0;
  const ids = [];
  let rows = 1;
  for (const param of line.slice(paramsStart, paramsEnd).split(",")) {
    const [key, value] = param.split("=", 2);
    if (value === void 0) continue;
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 4294967295) continue;
    if (key === "i") ids.push(numberValue);
    else if (key === "r") rows = numberValue;
  }
  return { ids, rows };
}
function extractKittyImageIds(line) {
  return parseKittyImageHeader(line)?.ids ?? [];
}
function extractKittyImageRows(line) {
  return parseKittyImageHeader(line)?.rows ?? 1;
}
function isTermuxSession() {
  return Boolean(process.env.TERMUX_VERSION);
}
var TuiMainScreen = class extends TuiBase {
  previousLines = [];
  previousKittyImageIds = /* @__PURE__ */ new Set();
  previousWidth = 0;
  previousHeight = 0;
  cursorRow = 0;
  hardwareCursorRow = 0;
  maxLinesRendered = 0;
  previousViewportTop = 0;
  resetRenderState() {
    this.previousLines = [];
    this.previousWidth = -1;
    this.previousHeight = -1;
    this.cursorRow = 0;
    this.hardwareCursorRow = 0;
    this.maxLinesRendered = 0;
    this.previousViewportTop = 0;
  }
  beforeTerminalStop() {
    if (this.previousLines.length === 0) return;
    this.terminal.write(" ");
    const targetRow = this.previousLines.length;
    const lineDiff = targetRow - this.hardwareCursorRow;
    if (lineDiff > 0) this.terminal.write(`\x1B[${lineDiff}B`);
    else if (lineDiff < 0) this.terminal.write(`\x1B[${-lineDiff}A`);
    this.terminal.write("\r\n");
  }
  collectKittyImageIds(lines) {
    const ids = /* @__PURE__ */ new Set();
    for (const line of lines) {
      for (const id of extractKittyImageIds(line)) {
        ids.add(id);
      }
    }
    return ids;
  }
  deleteKittyImages(ids) {
    let buffer = "";
    for (const id of ids) {
      buffer += deleteKittyImage(id);
    }
    return buffer;
  }
  getKittyImageReservedRows(lines, index, maxIndex = lines.length - 1) {
    const rows = extractKittyImageRows(lines[index] ?? "");
    if (rows <= 1) return 1;
    const maxRows = Math.min(rows, maxIndex - index + 1, lines.length - index);
    let reservedRows = 1;
    while (reservedRows < maxRows) {
      const line = lines[index + reservedRows] ?? "";
      if (isImageLine(line) || visibleWidth(line) > 0) break;
      reservedRows++;
    }
    return reservedRows;
  }
  expandChangedRangeForKittyImages(firstChanged, lastChanged, newLines) {
    let expandedFirstChanged = firstChanged;
    let expandedLastChanged = lastChanged;
    const expandForLines = (lines) => {
      for (let i = 0; i < lines.length; i++) {
        if (extractKittyImageIds(lines[i]).length === 0) continue;
        const blockEnd = i + this.getKittyImageReservedRows(lines, i) - 1;
        if (i >= firstChanged || i <= lastChanged && blockEnd >= firstChanged) {
          expandedFirstChanged = Math.min(expandedFirstChanged, i);
          expandedLastChanged = Math.max(expandedLastChanged, blockEnd);
        }
      }
    };
    expandForLines(this.previousLines);
    expandForLines(newLines);
    return { firstChanged: expandedFirstChanged, lastChanged: expandedLastChanged };
  }
  deleteChangedKittyImages(firstChanged, lastChanged) {
    if (firstChanged < 0 || lastChanged < firstChanged) return "";
    const ids = /* @__PURE__ */ new Set();
    const maxLine = Math.min(lastChanged, this.previousLines.length - 1);
    for (let i = firstChanged; i <= maxLine; i++) {
      for (const id of extractKittyImageIds(this.previousLines[i] ?? "")) {
        ids.add(id);
      }
    }
    return this.deleteKittyImages(ids);
  }
  doRender() {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
    const previousBufferLength = this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
    let prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : this.previousViewportTop;
    let viewportTop = prevViewportTop;
    let hardwareCursorRow = this.hardwareCursorRow;
    const computeLineDiff = (targetRow) => {
      const currentScreenRow = hardwareCursorRow - prevViewportTop;
      const targetScreenRow = targetRow - viewportTop;
      return targetScreenRow - currentScreenRow;
    };
    let newLines = this.render(width);
    if (this.hasOverlayEntries) {
      newLines = this.compositeOverlays(newLines, width, height);
    }
    const cursorPos = this.extractCursorPosition(newLines, height);
    newLines = this.applyLineResets(newLines);
    const fullRender = (clear) => {
      this.fullRedrawCount += 1;
      let buffer2 = "\x1B[?2026h";
      if (clear) {
        buffer2 += this.deleteKittyImages(this.previousKittyImageIds);
        buffer2 += "\x1B[2J\x1B[H\x1B[3J";
      }
      for (let i = 0; i < newLines.length; i++) {
        if (i > 0) buffer2 += "\r\n";
        const line = newLines[i];
        const isImage = isImageLine(line);
        const imageReservedRows = isImage ? this.getKittyImageReservedRows(newLines, i) : 1;
        if (imageReservedRows > 1 && imageReservedRows <= height) {
          for (let row = 1; row < imageReservedRows; row++) {
            buffer2 += "\r\n";
          }
          buffer2 += `\x1B[${imageReservedRows - 1}A`;
          buffer2 += line;
          buffer2 += `\x1B[${imageReservedRows - 1}B`;
          i += imageReservedRows - 1;
          continue;
        }
        buffer2 += line;
      }
      buffer2 += "\x1B[?2026l";
      this.terminal.write(buffer2);
      this.cursorRow = Math.max(0, newLines.length - 1);
      this.hardwareCursorRow = this.cursorRow;
      if (clear) {
        this.maxLinesRendered = newLines.length;
      } else {
        this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
      }
      const bufferLength = Math.max(height, newLines.length);
      this.previousViewportTop = Math.max(0, bufferLength - height);
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousLines = newLines;
      this.previousKittyImageIds = this.collectKittyImageIds(newLines);
      this.previousWidth = width;
      this.previousHeight = height;
    };
    const debugRedraw = process.env.PI_DEBUG_REDRAW === "1";
    const logRedraw = (reason) => {
      if (!debugRedraw) return;
      const logPath = path2.join(this.logDirectory, "pi-debug.log");
      const msg = `[${(/* @__PURE__ */ new Date()).toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})
`;
      fs.mkdirSync(path2.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, msg);
    };
    if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
      logRedraw("first render");
      fullRender(false);
      return;
    }
    if (widthChanged) {
      logRedraw(`terminal width changed (${this.previousWidth} -> ${width})`);
      fullRender(true);
      return;
    }
    if (heightChanged && !isTermuxSession()) {
      logRedraw(`terminal height changed (${this.previousHeight} -> ${height})`);
      fullRender(true);
      return;
    }
    if (this.getClearOnShrink() && newLines.length < this.maxLinesRendered && !this.hasOverlayEntries) {
      logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
      fullRender(true);
      return;
    }
    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
      const newLine = i < newLines.length ? newLines[i] : "";
      if (oldLine !== newLine) {
        if (firstChanged === -1) {
          firstChanged = i;
        }
        lastChanged = i;
      }
    }
    const appendedLines = newLines.length > this.previousLines.length;
    if (appendedLines) {
      if (firstChanged === -1) {
        firstChanged = this.previousLines.length;
      }
      lastChanged = newLines.length - 1;
    }
    if (firstChanged !== -1) {
      const expandedRange = this.expandChangedRangeForKittyImages(firstChanged, lastChanged, newLines);
      firstChanged = expandedRange.firstChanged;
      lastChanged = expandedRange.lastChanged;
    }
    const appendStart = appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;
    if (firstChanged === -1) {
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousViewportTop = prevViewportTop;
      this.previousHeight = height;
      return;
    }
    if (firstChanged >= newLines.length) {
      if (this.previousLines.length > newLines.length) {
        let buffer2 = "\x1B[?2026h";
        buffer2 += this.deleteChangedKittyImages(firstChanged, lastChanged);
        const targetRow = Math.max(0, newLines.length - 1);
        if (targetRow < prevViewportTop) {
          logRedraw(`deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`);
          fullRender(true);
          return;
        }
        const lineDiff2 = computeLineDiff(targetRow);
        if (lineDiff2 > 0) buffer2 += `\x1B[${lineDiff2}B`;
        else if (lineDiff2 < 0) buffer2 += `\x1B[${-lineDiff2}A`;
        buffer2 += "\r";
        const extraLines = this.previousLines.length - newLines.length;
        if (extraLines > height) {
          logRedraw(`extraLines > height (${extraLines} > ${height})`);
          fullRender(true);
          return;
        }
        const clearStartOffset = newLines.length === 0 ? 0 : 1;
        if (extraLines > 0 && clearStartOffset > 0) {
          buffer2 += `\x1B[${clearStartOffset}B`;
        }
        for (let i = 0; i < extraLines; i++) {
          buffer2 += "\r\x1B[2K";
          if (i < extraLines - 1) buffer2 += "\x1B[1B";
        }
        const moveBack = Math.max(0, extraLines - 1 + clearStartOffset);
        if (moveBack > 0) {
          buffer2 += `\x1B[${moveBack}A`;
        }
        buffer2 += "\x1B[?2026l";
        this.terminal.write(buffer2);
        this.cursorRow = targetRow;
        this.hardwareCursorRow = targetRow;
      }
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousLines = newLines;
      this.previousKittyImageIds = this.collectKittyImageIds(newLines);
      this.previousWidth = width;
      this.previousHeight = height;
      this.previousViewportTop = prevViewportTop;
      return;
    }
    if (firstChanged < prevViewportTop) {
      logRedraw(`firstChanged < viewportTop (${firstChanged} < ${prevViewportTop})`);
      fullRender(true);
      return;
    }
    let buffer = "\x1B[?2026h";
    buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);
    const prevViewportBottom = prevViewportTop + height - 1;
    const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
    if (moveTargetRow > prevViewportBottom) {
      const currentScreenRow = Math.max(0, Math.min(height - 1, hardwareCursorRow - prevViewportTop));
      const moveToBottom = height - 1 - currentScreenRow;
      if (moveToBottom > 0) {
        buffer += `\x1B[${moveToBottom}B`;
      }
      const scroll = moveTargetRow - prevViewportBottom;
      buffer += "\r\n".repeat(scroll);
      prevViewportTop += scroll;
      viewportTop += scroll;
      hardwareCursorRow = moveTargetRow;
    }
    const lineDiff = computeLineDiff(moveTargetRow);
    if (lineDiff > 0) {
      buffer += `\x1B[${lineDiff}B`;
    } else if (lineDiff < 0) {
      buffer += `\x1B[${-lineDiff}A`;
    }
    buffer += appendStart ? "\r\n" : "\r";
    const renderEnd = Math.min(lastChanged, newLines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i++) {
      if (i > firstChanged) buffer += "\r\n";
      const line = newLines[i];
      const isImage = isImageLine(line);
      const imageReservedRows = isImage ? this.getKittyImageReservedRows(newLines, i, renderEnd) : 1;
      if (imageReservedRows > 1) {
        const imageStartScreenRow = i - viewportTop;
        if (imageStartScreenRow < 0 || imageStartScreenRow + imageReservedRows > height) {
          logRedraw(
            `kitty image pre-clear would scroll (${imageStartScreenRow} + ${imageReservedRows} > ${height})`
          );
          fullRender(true);
          return;
        }
        buffer += "\x1B[2K";
        for (let row = 1; row < imageReservedRows; row++) {
          buffer += "\r\n\x1B[2K";
        }
        buffer += `\x1B[${imageReservedRows - 1}A`;
        buffer += line;
        buffer += `\x1B[${imageReservedRows - 1}B`;
        i += imageReservedRows - 1;
        continue;
      }
      buffer += "\x1B[2K";
      if (!isImage && visibleWidth(line) > width) {
        const crashLogPath = path2.join(this.logDirectory, "pi-crash.log");
        const crashData = [
          `Crash at ${(/* @__PURE__ */ new Date()).toISOString()}`,
          `Terminal width: ${width}`,
          `Line ${i} visible width: ${visibleWidth(line)}`,
          "",
          "=== All rendered lines ===",
          ...newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
          ""
        ].join("\n");
        fs.mkdirSync(path2.dirname(crashLogPath), { recursive: true });
        fs.writeFileSync(crashLogPath, crashData);
        this.stop();
        const errorMsg = [
          `Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
          "",
          "This is likely caused by a custom TUI component not truncating its output.",
          "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
          "",
          `Debug log written to: ${crashLogPath}`
        ].join("\n");
        throw new Error(errorMsg);
      }
      buffer += line;
    }
    let finalCursorRow = renderEnd;
    if (this.previousLines.length > newLines.length) {
      if (renderEnd < newLines.length - 1) {
        const moveDown = newLines.length - 1 - renderEnd;
        buffer += `\x1B[${moveDown}B`;
        finalCursorRow = newLines.length - 1;
      }
      const extraLines = this.previousLines.length - newLines.length;
      for (let i = newLines.length; i < this.previousLines.length; i++) {
        buffer += "\r\n\x1B[2K";
      }
      buffer += `\x1B[${extraLines}A`;
    }
    buffer += "\x1B[?2026l";
    if (process.env.PI_TUI_DEBUG === "1") {
      const debugDir = "/tmp/tui";
      fs.mkdirSync(debugDir, { recursive: true });
      const debugPath = path2.join(debugDir, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
      const debugData = [
        `firstChanged: ${firstChanged}`,
        `viewportTop: ${viewportTop}`,
        `cursorRow: ${this.cursorRow}`,
        `height: ${height}`,
        `lineDiff: ${lineDiff}`,
        `hardwareCursorRow: ${hardwareCursorRow}`,
        `renderEnd: ${renderEnd}`,
        `finalCursorRow: ${finalCursorRow}`,
        `cursorPos: ${JSON.stringify(cursorPos)}`,
        `newLines.length: ${newLines.length}`,
        `previousLines.length: ${this.previousLines.length}`,
        "",
        "=== newLines ===",
        JSON.stringify(newLines, null, 2),
        "",
        "=== previousLines ===",
        JSON.stringify(this.previousLines, null, 2),
        "",
        "=== buffer ===",
        JSON.stringify(buffer)
      ].join("\n");
      fs.writeFileSync(debugPath, debugData);
    }
    this.terminal.write(buffer);
    this.cursorRow = Math.max(0, newLines.length - 1);
    this.hardwareCursorRow = finalCursorRow;
    this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
    this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);
    this.positionHardwareCursor(cursorPos, newLines.length);
    this.previousLines = newLines;
    this.previousKittyImageIds = this.collectKittyImageIds(newLines);
    this.previousWidth = width;
    this.previousHeight = height;
  }
  /**
   * Position the hardware cursor for IME candidate window.
   * @param cursorPos The cursor position extracted from rendered output, or null
   * @param totalLines Total number of rendered lines
   */
  positionHardwareCursor(cursorPos, totalLines) {
    if (!cursorPos || totalLines <= 0) {
      this.terminal.hideCursor();
      return;
    }
    const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
    const targetCol = Math.max(0, cursorPos.col);
    const rowDelta = targetRow - this.hardwareCursorRow;
    let buffer = "";
    if (rowDelta > 0) {
      buffer += `\x1B[${rowDelta}B`;
    } else if (rowDelta < 0) {
      buffer += `\x1B[${-rowDelta}A`;
    }
    buffer += `\x1B[${targetCol + 1}G`;
    if (buffer) {
      this.terminal.write(buffer);
    }
    this.hardwareCursorRow = targetRow;
    if (this.getShowHardwareCursor()) {
      this.terminal.showCursor();
    } else {
      this.terminal.hideCursor();
    }
  }
};

// tui/src/terminal.ts
import * as fs2 from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import * as path4 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// tui/src/native-modifiers.ts
import { createRequire } from "node:module";
import * as path3 from "node:path";
import { fileURLToPath } from "node:url";
var cjsRequire = createRequire(import.meta.url);
var nativeModifiersHelper;
function isNativeModifiersHelper(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value.isModifierPressed;
  return typeof candidate === "function";
}
function loadNativeModifiersHelper() {
  if (nativeModifiersHelper !== void 0) return nativeModifiersHelper ?? void 0;
  nativeModifiersHelper = null;
  if (process.platform !== "darwin") return void 0;
  const arch = process.arch;
  if (arch !== "x64" && arch !== "arm64") return void 0;
  const moduleDir = path3.dirname(fileURLToPath(import.meta.url));
  const nativePath = path3.join("native", "darwin", "prebuilds", `darwin-${arch}`, "darwin-modifiers.node");
  const candidates = [
    path3.join(moduleDir, "..", nativePath),
    path3.join(moduleDir, nativePath),
    path3.join(path3.dirname(process.execPath), nativePath)
  ];
  for (const modulePath of candidates) {
    try {
      const helper = cjsRequire(modulePath);
      if (isNativeModifiersHelper(helper)) {
        nativeModifiersHelper = helper;
        return helper;
      }
    } catch {
    }
  }
  return void 0;
}
function isNativeModifierPressed(key) {
  const helper = loadNativeModifiersHelper();
  if (!helper) return false;
  try {
    return helper.isModifierPressed(key) === true;
  } catch {
    return false;
  }
}

// tui/src/terminal.ts
var cjsRequire2 = createRequire2(import.meta.url);
var TERMINAL_PROGRESS_KEEPALIVE_MS = 1e3;
var TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1B]9;4;3\x07";
var TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1B]9;4;0;\x07";
var APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1B[13;2u";
var DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7;
var KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;
var KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1B[>${DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS}u\x1B[?u\x1B[c`;
function parseKeyboardProtocolNegotiationSequence(sequence) {
  const kittyFlags = sequence.match(/^\x1b\[\?(\d+)u$/);
  if (kittyFlags) {
    return { type: "kitty-flags", flags: Number.parseInt(kittyFlags[1], 10) };
  }
  if (/^\x1b\[\?[\d;]*c$/.test(sequence)) {
    return { type: "device-attributes" };
  }
  return void 0;
}
function isKeyboardProtocolNegotiationSequencePrefix(sequence) {
  return sequence === "\x1B[" || /^\x1b\[\?[\d;]*$/.test(sequence);
}
function isAppleTerminalSession() {
  return process.platform === "darwin" && process.env.TERM_PROGRAM === "Apple_Terminal";
}
function normalizeAppleTerminalInput(data, isAppleTerminal, isShiftPressed) {
  if (isAppleTerminal && data === "\r" && isShiftPressed) return APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE;
  return data;
}
var ProcessTerminal = class {
  wasRaw = false;
  inputHandler;
  resizeHandler;
  _kittyProtocolActive = false;
  _modifyOtherKeysActive = false;
  keyboardProtocolPushed = false;
  keyboardProtocolNegotiationBuffer = "";
  keyboardProtocolBufferFlushTimer;
  stdinBuffer;
  stdinDataHandler;
  progressInterval;
  writeLogPath = (() => {
    const env = process.env.PI_TUI_WRITE_LOG || "";
    if (!env) return "";
    try {
      if (fs2.statSync(env).isDirectory()) {
        const now = /* @__PURE__ */ new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
        return path4.join(env, `tui-${ts}-${process.pid}.log`);
      }
    } catch {
    }
    return env;
  })();
  get kittyProtocolActive() {
    return this._kittyProtocolActive;
  }
  get modifyOtherKeysActive() {
    return this._modifyOtherKeysActive;
  }
  start(onInput, onResize) {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
    this.wasRaw = process.stdin.isRaw || false;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdout.write("\x1B[?2004h");
    process.stdout.on("resize", this.resizeHandler);
    if (process.platform !== "win32") {
      process.kill(process.pid, "SIGWINCH");
    }
    this.enableWindowsVTInput();
    this.queryAndEnableKittyProtocol();
  }
  /**
   * Set up StdinBuffer to split batched input into individual sequences.
   * This ensures components receive single events, making matchesKey/isKeyRelease work correctly.
   *
   * Also watches for Kitty protocol response and enables it when detected.
   * This is done here (after stdinBuffer parsing) rather than on raw stdin
   * to handle the case where the response arrives split across multiple events.
   */
  setupStdinBuffer() {
    this.stdinBuffer = new StdinBuffer({ timeout: 10 });
    this.stdinBuffer.on("data", (sequence) => {
      const negotiationSequence = this.readKeyboardProtocolNegotiationSequence(sequence);
      if (negotiationSequence === "pending") {
        this.scheduleKeyboardProtocolNegotiationBufferFlush();
        return;
      }
      if (this.handleKeyboardProtocolNegotiationSequence(negotiationSequence)) {
        return;
      }
      this.forwardInputSequence(sequence);
    });
    this.stdinBuffer.on("paste", (content) => {
      if (this.inputHandler) {
        this.inputHandler(`\x1B[200~${content}\x1B[201~`);
      }
    });
    this.stdinDataHandler = (data) => {
      this.stdinBuffer.process(data);
    };
  }
  /**
   * Query terminal for Kitty keyboard protocol support and enable it if available.
   *
   * Kitty's progressive enhancement detection requires requesting the desired
   * flags before querying them. The trailing DA query is a sentinel supported by
   * terminals that do not know Kitty keyboard protocol; receiving DA before a
   * Kitty response enables modifyOtherKeys fallback without a startup timeout.
   *
   * The requested flags are:
   * - 1 = disambiguate escape codes
   * - 2 = report event types (press/repeat/release)
   * - 4 = report alternate keys (shifted key, base layout key)
   */
  queryAndEnableKittyProtocol() {
    this.setupStdinBuffer();
    process.stdin.on("data", this.stdinDataHandler);
    this.keyboardProtocolPushed = true;
    this.clearKeyboardProtocolNegotiationBuffer();
    process.stdout.write(KITTY_KEYBOARD_PROTOCOL_QUERY);
  }
  handleKeyboardProtocolNegotiationSequence(negotiationSequence) {
    if (!negotiationSequence) return false;
    this.clearKeyboardProtocolNegotiationBuffer();
    if (negotiationSequence.type === "kitty-flags") {
      if (negotiationSequence.flags !== 0) {
        this.disableModifyOtherKeys();
        if (!this._kittyProtocolActive) {
          this._kittyProtocolActive = true;
          setKittyProtocolActive(true);
        }
      } else {
        this.enableModifyOtherKeys();
      }
      return true;
    }
    if (!this._kittyProtocolActive) {
      this.enableModifyOtherKeys();
    }
    return true;
  }
  readKeyboardProtocolNegotiationSequence(sequence) {
    if (this.keyboardProtocolNegotiationBuffer) {
      const bufferedSequence = this.keyboardProtocolNegotiationBuffer + sequence;
      const negotiationSequence2 = parseKeyboardProtocolNegotiationSequence(bufferedSequence);
      if (negotiationSequence2) {
        this.clearKeyboardProtocolNegotiationBuffer();
        return negotiationSequence2;
      }
      if (isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
        this.setKeyboardProtocolNegotiationBuffer(bufferedSequence);
        return "pending";
      }
      this.flushKeyboardProtocolNegotiationBufferAsInput();
    }
    const negotiationSequence = parseKeyboardProtocolNegotiationSequence(sequence);
    if (negotiationSequence) return negotiationSequence;
    if (isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
      this.setKeyboardProtocolNegotiationBuffer(sequence);
      return "pending";
    }
    return void 0;
  }
  setKeyboardProtocolNegotiationBuffer(sequence) {
    this.clearKeyboardProtocolNegotiationBufferFlushTimer();
    this.keyboardProtocolNegotiationBuffer = sequence;
  }
  clearKeyboardProtocolNegotiationBuffer() {
    this.clearKeyboardProtocolNegotiationBufferFlushTimer();
    this.keyboardProtocolNegotiationBuffer = "";
  }
  flushKeyboardProtocolNegotiationBufferAsInput() {
    if (!this.keyboardProtocolNegotiationBuffer) return;
    const sequence = this.keyboardProtocolNegotiationBuffer;
    this.clearKeyboardProtocolNegotiationBuffer();
    this.forwardInputSequence(sequence);
  }
  scheduleKeyboardProtocolNegotiationBufferFlush() {
    if (!this.keyboardProtocolNegotiationBuffer || this.keyboardProtocolBufferFlushTimer) return;
    this.keyboardProtocolBufferFlushTimer = setTimeout(() => {
      this.keyboardProtocolBufferFlushTimer = void 0;
      this.flushKeyboardProtocolNegotiationBufferAsInput();
    }, KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS);
  }
  clearKeyboardProtocolNegotiationBufferFlushTimer() {
    if (!this.keyboardProtocolBufferFlushTimer) return;
    clearTimeout(this.keyboardProtocolBufferFlushTimer);
    this.keyboardProtocolBufferFlushTimer = void 0;
  }
  forwardInputSequence(sequence) {
    if (!this.inputHandler) return;
    const isAppleTerminal = sequence === "\r" && isAppleTerminalSession();
    const input = normalizeAppleTerminalInput(
      sequence,
      isAppleTerminal,
      isAppleTerminal && isNativeModifierPressed("shift")
    );
    this.inputHandler(input);
  }
  enableModifyOtherKeys() {
    if (this._kittyProtocolActive || this._modifyOtherKeysActive) return;
    process.stdout.write("\x1B[>4;2m");
    this._modifyOtherKeysActive = true;
  }
  disableModifyOtherKeys() {
    if (!this._modifyOtherKeysActive) return;
    process.stdout.write("\x1B[>4;0m");
    this._modifyOtherKeysActive = false;
  }
  /**
   * On Windows, add ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) to the stdin
   * console handle so the terminal sends VT sequences for modified keys
   * (e.g. \x1b[Z for Shift+Tab). Without this, libuv's ReadConsoleInputW
   * discards modifier state and Shift+Tab arrives as plain \t.
   */
  enableWindowsVTInput() {
    if (process.platform !== "win32") return;
    try {
      const arch = process.arch;
      if (arch !== "x64" && arch !== "arm64") return;
      const moduleDir = path4.dirname(fileURLToPath2(import.meta.url));
      const nativePath = path4.join("native", "win32", "prebuilds", `win32-${arch}`, "win32-console-mode.node");
      const candidates = [
        path4.join(moduleDir, "..", nativePath),
        path4.join(moduleDir, nativePath),
        path4.join(path4.dirname(process.execPath), nativePath)
      ];
      for (const modulePath of candidates) {
        try {
          const helper = cjsRequire2(modulePath);
          helper.enableVirtualTerminalInput?.();
          return;
        } catch {
        }
      }
    } catch {
    }
  }
  async drainInput(maxMs = 1e3, idleMs = 50) {
    const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this._kittyProtocolActive;
    this.clearKeyboardProtocolNegotiationBuffer();
    if (shouldDisableKittyProtocol) {
      process.stdout.write("\x1B[<u");
      this.keyboardProtocolPushed = false;
      this._kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    this.disableModifyOtherKeys();
    const previousHandler = this.inputHandler;
    this.inputHandler = void 0;
    let lastDataTime = Date.now();
    const onData = () => {
      lastDataTime = Date.now();
    };
    process.stdin.on("data", onData);
    const endTime = Date.now() + maxMs;
    try {
      while (true) {
        const now = Date.now();
        const timeLeft = endTime - now;
        if (timeLeft <= 0) break;
        if (now - lastDataTime >= idleMs) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(idleMs, timeLeft)));
      }
    } finally {
      process.stdin.removeListener("data", onData);
      this.inputHandler = previousHandler;
    }
  }
  stop() {
    if (this.clearProgressInterval()) {
      process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
    }
    process.stdout.write("\x1B[?2004l");
    const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this._kittyProtocolActive;
    this.clearKeyboardProtocolNegotiationBuffer();
    if (shouldDisableKittyProtocol) {
      process.stdout.write("\x1B[<u");
      this.keyboardProtocolPushed = false;
      this._kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    this.disableModifyOtherKeys();
    if (this.stdinBuffer) {
      this.stdinBuffer.destroy();
      this.stdinBuffer = void 0;
    }
    if (this.stdinDataHandler) {
      process.stdin.removeListener("data", this.stdinDataHandler);
      this.stdinDataHandler = void 0;
    }
    this.inputHandler = void 0;
    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
      this.resizeHandler = void 0;
    }
    process.stdin.pause();
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(this.wasRaw);
    }
  }
  write(data) {
    process.stdout.write(data);
    if (this.writeLogPath) {
      try {
        fs2.appendFileSync(this.writeLogPath, data, { encoding: "utf8" });
      } catch {
      }
    }
  }
  get columns() {
    return process.stdout.columns || Number(process.env.COLUMNS) || 80;
  }
  get rows() {
    return process.stdout.rows || Number(process.env.LINES) || 24;
  }
  moveBy(lines) {
    if (lines > 0) {
      process.stdout.write(`\x1B[${lines}B`);
    } else if (lines < 0) {
      process.stdout.write(`\x1B[${-lines}A`);
    }
  }
  hideCursor() {
    process.stdout.write("\x1B[?25l");
  }
  showCursor() {
    process.stdout.write("\x1B[?25h");
  }
  clearLine() {
    process.stdout.write("\x1B[K");
  }
  clearFromCursor() {
    process.stdout.write("\x1B[J");
  }
  clearScreen() {
    process.stdout.write("\x1B[2J\x1B[H");
  }
  setTitle(title) {
    process.stdout.write(`\x1B]0;${title}\x07`);
  }
  setProgress(active) {
    if (active) {
      process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
      if (!this.progressInterval) {
        this.progressInterval = setInterval(() => {
          process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
        }, TERMINAL_PROGRESS_KEEPALIVE_MS);
      }
    } else {
      this.clearProgressInterval();
      process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
    }
  }
  clearProgressInterval() {
    if (!this.progressInterval) return false;
    clearInterval(this.progressInterval);
    this.progressInterval = void 0;
    return true;
  }
};
export {
  Box,
  CURSOR_MARKER,
  CancellableLoader,
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Image,
  Input,
  Key,
  KeybindingsManager,
  Loader,
  Markdown,
  Marked2 as Marked,
  ProcessTerminal,
  SelectList,
  SettingsList,
  Spacer,
  StdinBuffer,
  TUI_KEYBINDINGS,
  Text,
  TruncatedText,
  TuiAltScreen,
  TuiMainScreen,
  allocateImageId,
  calculateImageRows,
  compositeTuiLine,
  decodeKittyPrintable,
  deleteAllKittyImages,
  deleteKittyImage,
  detectCapabilities,
  encodeITerm2,
  encodeKitty,
  fuzzyFilter,
  fuzzyMatch,
  getCapabilities,
  getCellDimensions,
  getGifDimensions,
  getImageDimensions,
  getJpegDimensions,
  getKeybindings,
  getOsc8LinkAtColumn,
  getPngDimensions,
  getWebpDimensions,
  hyperlink,
  imageFallback,
  isFocusable,
  isKeyRelease,
  isKeyRepeat,
  isKittyProtocolActive,
  matchesKey,
  parseKey,
  parseOsc11BackgroundColor,
  parseTerminalColorSchemeReport,
  renderImage,
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
  setKeybindings,
  setKittyProtocolActive,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi
};
