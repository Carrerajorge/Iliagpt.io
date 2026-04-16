const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

let inMemoryCsrfToken: string | null = null;

export function getInMemoryCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function setInMemoryCsrfToken(token: string): void {
  if (CSRF_TOKEN_PATTERN.test(token)) {
    inMemoryCsrfToken = token;
  }
}

export function getCsrfToken(): string | null {
  if (typeof document === "undefined") {
    return inMemoryCsrfToken;
  }
  const match = document.cookie.match(/(^|;\s*)XSRF-TOKEN=([^;]*)/);
  const cookieVal = match ? decodeURIComponent(match[2]) : null;
  return cookieVal || inMemoryCsrfToken;
}
