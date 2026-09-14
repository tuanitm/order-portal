/**
 * OTP (One-Time Password) utility.
 * In-memory store for development. Use Redis/MySQL in production.
 */

interface OtpEntry {
  code: string;
  purpose: "signup" | "forgot-password";
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
}

// In-memory OTP store (keyed by email)
const otpStore = new Map<string, OtpEntry>();

// OTP settings
const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_MS = 60 * 1000; // 1 minute between sends

// Track last send time per email
const lastSendTime = new Map<string, number>();

/**
 * Generate a random numeric OTP code.
 */
export function generateOtp(length: number = OTP_LENGTH): string {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

/**
 * Check if we can send an OTP (cooldown check).
 */
export function canSendOtp(email: string): { allowed: boolean; waitSeconds?: number } {
  const normalizedEmail = email.toLowerCase().trim();
  const lastSent = lastSendTime.get(normalizedEmail);

  if (lastSent) {
    const elapsed = Date.now() - lastSent;
    if (elapsed < OTP_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
      return { allowed: false, waitSeconds };
    }
  }

  return { allowed: true };
}

/**
 * Store an OTP for a given email.
 */
export function storeOtp(
  email: string,
  purpose: "signup" | "forgot-password"
): string {
  const normalizedEmail = email.toLowerCase().trim();
  const code = generateOtp();

  otpStore.set(normalizedEmail, {
    code,
    purpose,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
  });

  lastSendTime.set(normalizedEmail, Date.now());

  // Auto-cleanup expired entries
  setTimeout(() => {
    const entry = otpStore.get(normalizedEmail);
    if (entry && entry.code === code) {
      otpStore.delete(normalizedEmail);
    }
  }, OTP_EXPIRY_MS + 1000);

  return code;
}

/**
 * Verify an OTP code for a given email.
 */
export function verifyOtp(
  email: string,
  code: string,
  purpose: "signup" | "forgot-password"
): { valid: boolean; error?: string } {
  const normalizedEmail = email.toLowerCase().trim();
  const entry = otpStore.get(normalizedEmail);

  if (!entry) {
    return { valid: false, error: "otp_not_found" };
  }

  if (entry.purpose !== purpose) {
    return { valid: false, error: "otp_wrong_purpose" };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(normalizedEmail);
    return { valid: false, error: "otp_expired" };
  }

  if (entry.attempts >= entry.maxAttempts) {
    otpStore.delete(normalizedEmail);
    return { valid: false, error: "otp_max_attempts" };
  }

  entry.attempts++;

  if (entry.code !== code) {
    return { valid: false, error: "otp_invalid" };
  }

  // Valid — remove from store
  otpStore.delete(normalizedEmail);
  return { valid: true };
}

/**
 * Clear OTP for an email (e.g., after successful signup).
 */
export function clearOtp(email: string): void {
  otpStore.delete(email.toLowerCase().trim());
}
