import { describe, it, expect } from 'vitest';
import {
  TransformDirection,
  createTransformationRule,
  parseTransformationRule,
  applyTransformation,
} from '../../../src/security/transformations.js';
import { InvalidArgumentError } from '../../../src/errors.js';

describe('TransformDirection enum', () => {
  it('has expected values', () => {
    expect(TransformDirection.Outbound).toBe('outbound');
    expect(TransformDirection.Inbound).toBe('inbound');
    expect(TransformDirection.Both).toBe('both');
  });
});

describe('createTransformationRule', () => {
  it('creates rule with defaults', () => {
    const rule = createTransformationRule({ match: 'foo', replace: 'bar' });
    expect(rule.match).toBe('foo');
    expect(rule.replace).toBe('bar');
    expect(rule.direction).toBe('outbound');
  });

  it('accepts direction override', () => {
    const rule = createTransformationRule({
      match: '\\d+',
      replace: '[NUM]',
      direction: TransformDirection.Outbound,
    });
    expect(rule.direction).toBe('outbound');
  });

  it('throws on invalid regex', () => {
    expect(() => createTransformationRule({ match: '[invalid', replace: '' })).toThrow(
      InvalidArgumentError,
    );
  });

  it('throws on invalid direction', () => {
    expect(() =>
      createTransformationRule({ match: 'x', replace: 'y', direction: 'sideways' }),
    ).toThrow(InvalidArgumentError);
  });
});

describe('applyTransformation', () => {
  it('replaces matching text', () => {
    const rule = createTransformationRule({ match: 'secret', replace: '[REDACTED]' });
    expect(applyTransformation(rule, 'my secret data')).toBe('my [REDACTED] data');
  });

  it('replaces all occurrences (global)', () => {
    const rule = createTransformationRule({ match: 'a', replace: 'b' });
    expect(applyTransformation(rule, 'banana')).toBe('bbnbnb');
  });

  it('handles regex patterns', () => {
    const rule = createTransformationRule({ match: '\\d{3}-\\d{4}', replace: 'XXX-XXXX' });
    expect(applyTransformation(rule, 'Call 555-1234 or 555-5678')).toBe(
      'Call XXX-XXXX or XXX-XXXX',
    );
  });

  it('returns original text when no match', () => {
    const rule = createTransformationRule({ match: 'xyz', replace: 'abc' });
    expect(applyTransformation(rule, 'hello world')).toBe('hello world');
  });

  it('handles empty replacement', () => {
    const rule = createTransformationRule({ match: '\\s+', replace: '' });
    expect(applyTransformation(rule, 'hello world')).toBe('helloworld');
  });
});

describe('parseTransformationRule', () => {
  it('parses data and defaults direction to outbound', () => {
    const rule = parseTransformationRule({ match: 'foo', replace: 'bar' });
    expect(rule.direction).toBe('outbound');
  });

  it('respects explicit direction', () => {
    const rule = parseTransformationRule({ match: 'foo', replace: 'bar', direction: 'both' });
    expect(rule.direction).toBe('both');
  });

  it('throws on invalid regex via the same validation path as create', () => {
    expect(() => parseTransformationRule({ match: '[invalid', replace: '' })).toThrow(
      InvalidArgumentError,
    );
  });

  it('throws when match or replace is missing', () => {
    expect(() => parseTransformationRule({ replace: 'bar' } as Record<string, unknown>)).toThrow(
      InvalidArgumentError,
    );
  });
});
