// POSIX path helpers for the browser build, where `node:path` is not available. They return
// exactly what Node's `path.posix` returns.

const SLASH = 47;
const DOT = 46;

/** Resolves `.` and `..` segments; `..` above the start is kept only when `allowAboveRoot`. */
function normalizeString(path: string, allowAboveRoot: boolean): string {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (code === SLASH) break;
    else code = SLASH;

    if (code === SLASH) {
      if (lastSlash === i - 1 || dots === 1) {
        // An empty segment or `.`: nothing to add.
      } else if (dots === 2) {
        const endsWithDotDot =
          res.length >= 2 &&
          lastSegmentLength === 2 &&
          res.charCodeAt(res.length - 1) === DOT &&
          res.charCodeAt(res.length - 2) === DOT;
        if (!endsWithDotDot) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf('/');
            if (lastSlashIndex === -1) {
              res = '';
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? '/..' : '..';
          lastSegmentLength = 2;
        }
      } else {
        const segment = path.slice(lastSlash + 1, i);
        res = res.length > 0 ? `${res}/${segment}` : segment;
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

/** Collapses `.`, `..` and repeated slashes, like `path.posix.normalize`. */
export function normalize(path: string): string {
  if (path.length === 0) return '.';
  const absolute = path.charCodeAt(0) === SLASH;
  const trailingSlash = path.charCodeAt(path.length - 1) === SLASH;
  let out = normalizeString(path, !absolute);
  if (out.length === 0) {
    if (absolute) return '/';
    return trailingSlash ? './' : '.';
  }
  if (trailingSlash) out += '/';
  return absolute ? `/${out}` : out;
}

/** Joins the non-empty parts with `/` and normalizes the result, like `path.posix.join`. */
export function join(...parts: string[]): string {
  const joined = parts.filter((part) => part.length > 0).join('/');
  return joined.length === 0 ? '.' : normalize(joined);
}

/** An absolute path without `.`, `..`, repeated or trailing slashes. */
function resolveAbsolute(path: string): string {
  return `/${normalizeString(path, false)}`;
}

/** The path from the absolute path `from` to the absolute path `to`, like `path.posix.relative`. */
export function relative(fromPath: string, toPath: string): string {
  const from = resolveAbsolute(fromPath);
  const to = resolveAbsolute(toPath);
  if (from === to) return '';

  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  const toStart = 1;
  const toLen = to.length - toStart;

  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === SLASH) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) {
      // `from` is a prefix of `to`: `/a` → `/a/b`, or the root → `/a`.
      if (to.charCodeAt(toStart + i) === SLASH) return to.slice(toStart + i + 1);
      if (i === 0) return to.slice(toStart + i);
    } else if (fromLen > length) {
      // `to` is a prefix of `from`: `/a/b` → `/a`, or `/a` → the root.
      if (from.charCodeAt(fromStart + i) === SLASH) lastCommonSep = i;
      else if (i === 0) lastCommonSep = 0;
    }
  }

  let out = '';
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === SLASH) out += out.length === 0 ? '..' : '/..';
  }
  return `${out}${to.slice(toStart + lastCommonSep)}`;
}

/** Everything before the last segment, like `path.posix.dirname`. */
export function dirname(path: string): string {
  if (path.length === 0) return '.';
  const hasRoot = path.charCodeAt(0) === SLASH;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === SLASH) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

/** The last segment, trailing slashes ignored, like `path.posix.basename`. */
export function basename(path: string): string {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === SLASH) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  return end === -1 ? '' : path.slice(start, end);
}
