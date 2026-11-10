/**
 * Remove secrets from anything that may end up in a log or an error message.
 *
 * go2rtc's Xiaomi source builds URLs that carry key material
 * (client_private, sign, device_public, password) and the config holds
 * Xiaomi tokens in the form "V1:...". None of it may ever be printed.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(client_private|client_public|device_public|sign|password|token|ssecurity|serviceToken)=([^&\s"']+)/gi, '$1=***'],
  [/\bV1:[A-Za-z0-9+/=_-]{6,}/g, 'V1:***'],
  // userId:region@ip in xiaomi:// URLs
  [/xiaomi:\/\/[^@\s"']+@/gi, 'xiaomi://***@'],
  // basic-auth credentials in URLs
  [/(\/\/)[^/\s:@"']+:[^/\s@"']+@/g, '$1***:***@'],
  [/("?(?:password|token|cookie|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out;
}
