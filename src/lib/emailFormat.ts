/**
 * A user's email is ONE address — it's a sign-in name and where OTP codes go.
 * (SAP's customer email field can hold several, "a@x.com;b@y.com"; that one
 * is never copied onto a user.)
 */
const SINGLE_EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

export function isSingleEmail(value: string): boolean {
  return value.length <= 255 && SINGLE_EMAIL.test(value);
}
