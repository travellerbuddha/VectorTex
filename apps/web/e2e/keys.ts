/** TEST-ONLY key sealing TOTP secrets in the e2e database (never a deployment value). */
export const E2E_STAFF_MFA_KEY = Buffer.alloc(32, 9).toString('base64');
/** TEST-ONLY password of the e2e administrator created in global setup. */
export const E2E_ADMIN_PASSWORD = 'e2e panel passphrase 2027';
