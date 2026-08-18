import { describe, it, expect } from 'vitest';
import { wrapInline, prefixLines, insertLink } from './markdownFormat';

describe('wrapInline', () => {
  it('wraps a selection in the marker, shifting the selection to still cover the original text', () => {
    const value = 'hello world';
    // select "world" (indices 6..11)
    const result = wrapInline(value, 6, 11, '**');
    expect(result.value).toBe('hello **world**');
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('world');
  });

  it('wraps with a single-char marker (italic)', () => {
    const value = 'hello world';
    const result = wrapInline(value, 0, 5, '*');
    expect(result.value).toBe('*hello* world');
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('hello');
  });

  it('wraps with a backtick marker (inline code)', () => {
    const value = 'call foo() now';
    const result = wrapInline(value, 5, 10, '`');
    expect(result.value).toBe('call `foo()` now');
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('foo()');
  });

  it('with no selection, inserts an empty marker pair and collapses the cursor between them', () => {
    const value = 'hello world';
    // cursor after "hello" (index 5)
    const result = wrapInline(value, 5, 5, '**');
    expect(result.value).toBe('hello**** world');
    expect(result.selStart).toBe(result.selEnd);
    expect(result.selStart).toBe(7); // 5 + '**'.length
  });

  it('no-selection insert works at the very start and end of the value', () => {
    const value = 'abc';
    const atStart = wrapInline(value, 0, 0, '*');
    expect(atStart.value).toBe('**abc');
    expect(atStart.selStart).toBe(1);
    expect(atStart.selEnd).toBe(1);

    const atEnd = wrapInline(value, 3, 3, '*');
    expect(atEnd.value).toBe('abc**');
    expect(atEnd.selStart).toBe(4);
    expect(atEnd.selEnd).toBe(4);
  });
});

describe('prefixLines', () => {
  it('prefixes a single line touched by a collapsed cursor', () => {
    const value = 'one\ntwo\nthree';
    // cursor somewhere inside "two" (indices 4..7)
    const result = prefixLines(value, 5, 5, '- ');
    expect(result.value).toBe('one\n- two\nthree');
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('- two');
  });

  it('prefixes every line spanned by a multi-line selection (bullets)', () => {
    const value = 'one\ntwo\nthree';
    // select from start of "one" through middle of "three"
    const result = prefixLines(value, 0, value.length, '- ');
    expect(result.value).toBe('- one\n- two\n- three');
    expect(result.selStart).toBe(0);
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('- one\n- two\n- three');
  });

  it('prefixes with a quote marker', () => {
    const value = 'a\nb';
    const result = prefixLines(value, 0, value.length, '> ');
    expect(result.value).toBe('> a\n> b');
  });

  it('numbers lines sequentially via a makePrefix function', () => {
    const value = 'first\nsecond\nthird';
    const result = prefixLines(value, 0, value.length, (i) => `${i + 1}. `);
    expect(result.value).toBe('1. first\n2. second\n3. third');
  });

  it('numbers only the lines actually touched by a partial selection', () => {
    const value = 'first\nsecond\nthird';
    // selection only within "second" and "third" (from start of "second" to end)
    const s = value.indexOf('second');
    const result = prefixLines(value, s, value.length, (i) => `${i + 1}. `);
    expect(result.value).toBe('first\n1. second\n2. third');
  });

  it('only touches a single line for a selection entirely within one line', () => {
    const value = 'one\ntwo\nthree';
    const s = value.indexOf('two');
    const e = s + 'two'.length;
    const result = prefixLines(value, s, e, '- ');
    expect(result.value).toBe('one\n- two\nthree');
  });
});

describe('insertLink', () => {
  it('wraps the selected text as link text, with the selection covering the url placeholder', () => {
    const value = 'see docs here';
    const s = value.indexOf('docs');
    const e = s + 'docs'.length;
    const result = insertLink(value, s, e);
    expect(result.value).toBe('see [docs](https://) here');
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('https://');
  });

  it('uses a "text" placeholder when there is no selection', () => {
    const value = 'see  here';
    const s = value.indexOf('  ') + 1;
    const result = insertLink(value, s, s);
    expect(result.value).toBe('see [text](https://) here');
    expect(result.value.slice(result.selStart, result.selEnd)).toBe('https://');
  });

  it('the returned selection can be typed over to replace the url', () => {
    const value = 'link';
    const result = insertLink(value, 0, 4);
    expect(result.value).toBe('[link](https://)');
    const withTyped = result.value.slice(0, result.selStart) + 'example.com' + result.value.slice(result.selEnd);
    expect(withTyped).toBe('[link](example.com)');
  });
});
