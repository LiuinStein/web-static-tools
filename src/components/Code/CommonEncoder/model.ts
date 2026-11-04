export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(value: string): string {
  const binary = atob(value);
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

export interface EncodingState { raw: string; encoded: string; encoding: boolean; error: string; }
export function convertInput(value: string, encoding: boolean, convert: (value: string) => string): EncodingState {
  try {
    const result = convert(value);
    return { raw: encoding ? value : result, encoded: encoding ? result : value, encoding, error: '' };
  } catch {
    return { raw: encoding ? value : '', encoded: encoding ? '' : value, encoding, error: encoding ? '输入暂时无法编码，请检查内容。' : '编码不完整或格式无效，请继续输入或检查内容。' };
  }
}
