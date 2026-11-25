import { describe, it, expect } from 'vitest';
import { cleanSanList } from './san-input';

describe('cleanSanList', () => {
  it('removes whitespace at the ends of each entry', () => {
    expect(cleanSanList([' portal.acme.example', 'www.acme.example ', '\t192.0.2.10\n'])).toEqual([
      'portal.acme.example',
      'www.acme.example',
      '192.0.2.10',
    ]);
  });

  it('drops empty entries and entries of whitespace only', () => {
    expect(cleanSanList(['', '   ', 'portal.acme.example', '\n'])).toEqual(['portal.acme.example']);
  });

  it('gives undefined when no entry is left, so the request has no empty list', () => {
    expect(cleanSanList([''])).toBeUndefined();
    expect(cleanSanList([' ', '\t'])).toBeUndefined();
    expect(cleanSanList([])).toBeUndefined();
  });

  it('does not change whitespace inside an entry: the backend refuses it', () => {
    expect(cleanSanList(['portal acme.example'])).toEqual(['portal acme.example']);
  });

  it('keeps the order and does not change the input', () => {
    const input = [' b.example', 'a.example '];
    expect(cleanSanList(input)).toEqual(['b.example', 'a.example']);
    expect(input).toEqual([' b.example', 'a.example ']);
  });
});
