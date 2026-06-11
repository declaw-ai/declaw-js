import { InvalidArgumentError } from '../errors.js';

/** Direction in which a transformation rule applies. */
export enum TransformDirection {
  Outbound = 'outbound',
  Inbound = 'inbound',
  Both = 'both',
}

const VALID_DIRECTIONS = new Set(Object.values(TransformDirection));

/** A text transformation rule using regex matching. */
export interface TransformationRule {
  match: string;
  replace: string;
  direction: string;
}

/** Maximum allowed length for regex patterns to limit complexity. */
const MAX_PATTERN_LENGTH = 1000;

/**
 * Detect regex patterns vulnerable to catastrophic backtracking (ReDoS).
 * Checks for nested quantifiers like (a+)+, (a*)+, (a+)*, etc.
 */
const REDOS_PATTERN = /(\(.*[+*].*\))[+*]|\(\?:[^)]*[+*][^)]*\)[+*]/;

/**
 * Create a TransformationRule with validation.
 * Validates that `match` is a valid regex, checks for ReDoS-vulnerable patterns,
 * and validates `direction`.
 */
export function createTransformationRule(opts: {
  match: string;
  replace: string;
  direction?: string;
}): TransformationRule {
  if (opts.match.length > MAX_PATTERN_LENGTH) {
    throw new InvalidArgumentError(
      `Regex pattern too long (${opts.match.length} chars, max ${MAX_PATTERN_LENGTH}).`,
    );
  }

  // Reject patterns with nested quantifiers (common ReDoS vector)
  if (REDOS_PATTERN.test(opts.match)) {
    throw new InvalidArgumentError(
      `Regex pattern "${opts.match}" contains nested quantifiers which may cause catastrophic backtracking (ReDoS). Simplify the pattern.`,
    );
  }

  // Validate regex syntax
  try {
    new RegExp(opts.match);
  } catch {
    throw new InvalidArgumentError(`Invalid regex pattern: "${opts.match}"`);
  }

  const direction = opts.direction ?? TransformDirection.Outbound;

  if (!VALID_DIRECTIONS.has(direction as TransformDirection)) {
    throw new InvalidArgumentError(
      `Invalid transform direction: "${direction}". Valid values: ${[...VALID_DIRECTIONS].join(', ')}`,
    );
  }

  return {
    match: opts.match,
    replace: opts.replace,
    direction,
  };
}

/**
 * Parse raw JSON data into a TransformationRule, validating regex + direction.
 * Matches Python's TransformationRule.from_dict, which runs the same checks as construction.
 */
export function parseTransformationRule(data: Record<string, unknown>): TransformationRule {
  if (typeof data.match !== 'string' || typeof data.replace !== 'string') {
    throw new InvalidArgumentError(
      'TransformationRule requires string "match" and "replace" fields.',
    );
  }
  return createTransformationRule({
    match: data.match,
    replace: data.replace,
    direction: (data.direction as string | undefined) ?? TransformDirection.Outbound,
  });
}

/**
 * Apply a transformation rule to text.
 * Uses the rule's `match` as a global regex and replaces with `replace`.
 */
export function applyTransformation(rule: TransformationRule, text: string): string {
  const regex = new RegExp(rule.match, 'g');
  return text.replace(regex, rule.replace);
}
