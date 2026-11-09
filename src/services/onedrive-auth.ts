import { InteractionRequiredAuthError } from '@azure/msal-browser';

export class OneDriveAuthRequiredError extends Error {
  readonly errorCode = 'onedrive_reauthorization_required';
  constructor(message = 'Microsoft 登录已过期或静默授权超时。请点击「重新授权 OneDrive」完成登录，本机草稿不受影响。') {
    super(message); this.name = 'OneDriveAuthRequiredError';
  }
}
export function isOneDriveAuthRequired(error: any): boolean {
  const codes = new Set(['onedrive_reauthorization_required', 'interaction_required', 'login_required', 'consent_required', 'monitor_window_timeout', 'iframe_closed_prematurely', 'block_iframe_reload', 'token_refresh_required', 'no_tokens_found', 'refresh_token_expired', 'invalid_grant']);
  for (let depth = 0; error && depth < 4; depth++, error = error.cause) {
    if (error instanceof InteractionRequiredAuthError || codes.has(error.errorCode)) return true;
  }
  return false;
}

// Let MSAL's parent window read and validate the response before a hash router runs.
export function isOneDriveAuthCallback(location: Pick<Location, 'hash' | 'search'>, childWindow: boolean): boolean {
  if (!childWindow) return false;
  return [location.search.slice(1), location.hash.startsWith('#/') ? '' : location.hash.slice(1)].some(value => {
    const params = new URLSearchParams(value);
    return params.has('state') && (params.has('code') || params.has('error'));
  });
}
