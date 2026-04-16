/**
 * 2FA/MFA Service
 * Implements TOTP-based two-factor authentication
 */

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';

const APP_NAME = 'ILIAGPT';
const BACKUP_CODES_COUNT = 10;

interface MfaSetupResult {
    secret: string;
    otpAuthUrl: string;
    qrCodeDataUrl: string;
    backupCodes: string[];
}

interface MfaVerifyResult {
    success: boolean;
    usedBackupCode?: boolean;
}

/**
 * Generate a new MFA secret and QR code for setup
 */
export async function generateMfaSecret(userEmail: string): Promise<MfaSetupResult> {
    // Generate secret
    const secret = authenticator.generateSecret();

    // Generate OTP Auth URL
    const otpAuthUrl = authenticator.keyuri(userEmail, APP_NAME, secret);

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, {
        width: 256,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff',
        },
    });

    // Generate backup codes
    const backupCodes = generateBackupCodes(BACKUP_CODES_COUNT);

    return {
        secret,
        otpAuthUrl,
        qrCodeDataUrl,
        backupCodes,
    };
}

/**
 * Verify a TOTP code against a secret
 */
export function verifyTotp(token: string, secret: string): boolean {
    try {
        return authenticator.verify({ token, secret });
    } catch {
        return false;
    }
}

/**
 * Verify a backup code
 */
export function verifyBackupCode(
    inputCode: string,
    storedCodes: string[]
): { valid: boolean; remainingCodes: string[] } {
    const normalizedInput = inputCode.replace(/[-\s]/g, '').toUpperCase();
    const index = storedCodes.findIndex(
        code => code.replace(/-/g, '').toUpperCase() === normalizedInput
    );

    if (index === -1) {
        return { valid: false, remainingCodes: storedCodes };
    }

    // Remove used code
    const remainingCodes = [...storedCodes];
    remainingCodes.splice(index, 1);

    return { valid: true, remainingCodes };
}

/**
 * Complete MFA verification (TOTP or backup code)
 */
export function verifyMfa(
    code: string,
    secret: string,
    backupCodes: string[]
): MfaVerifyResult {
    // Try TOTP first
    if (code.length === 6 && /^\d+$/.test(code)) {
        const valid = verifyTotp(code, secret);
        if (valid) {
            return { success: true, usedBackupCode: false };
        }
    }

    // Try backup code
    const { valid, remainingCodes } = verifyBackupCode(code, backupCodes);
    if (valid) {
        return { success: true, usedBackupCode: true };
    }

    return { success: false };
}

/**
 * Generate random backup codes
 */
function generateBackupCodes(count: number): string[] {
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
        // Generate 8 random hex characters, formatted as XXXX-XXXX
        const randomBytes = crypto.randomBytes(4);
        const code = randomBytes.toString('hex').toUpperCase();
        const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
        codes.push(formatted);
    }

    return codes;
}

/**
 * Hash backup codes for storage
 */
export function hashBackupCodes(codes: string[]): string[] {
    return codes.map(code =>
        crypto.createHash('sha256')
            .update(code.replace(/-/g, '').toUpperCase())
            .digest('hex')
    );
}

/**
 * Check if a backup code matches any hashed code
 */
export function checkHashedBackupCode(
    inputCode: string,
    hashedCodes: string[]
): { valid: boolean; usedIndex: number } {
    const normalizedInput = inputCode.replace(/[-\s]/g, '').toUpperCase();
    const inputHash = crypto.createHash('sha256').update(normalizedInput).digest('hex');

    const index = hashedCodes.findIndex(hash => hash === inputHash);

    return { valid: index !== -1, usedIndex: index };
}
