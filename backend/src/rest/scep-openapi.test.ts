import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { OpenAPIV3_1 } from 'openapi-types';

describe('standalone SCEP protocol specification', () => {
  it('documents binary CMS requests and signed failures independently of backend bearer tokens', () => {
    const gateway = yaml.load(readFileSync(new URL('../../../scep/openapi.yaml', import.meta.url), 'utf8')) as OpenAPIV3_1.Document;
    expect(gateway.openapi).toBe('3.1.0');
    expect(gateway.security).toEqual([]);
    expect(Object.keys(gateway.paths ?? {})).toEqual(['/scep']);
    expect(gateway.paths?.['/scep']?.post?.requestBody).toMatchObject({
      required: true, content: { 'application/x-pki-message': { schema: { format: 'binary' } } },
    });
    expect(gateway.paths?.['/scep']?.post?.responses?.['200']?.description).toContain('pkiStatus');
  });
});
