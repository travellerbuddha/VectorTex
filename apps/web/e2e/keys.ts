/** TEST-ONLY key sealing TOTP secrets in the e2e database (never a deployment value). */
export const E2E_STAFF_MFA_KEY = Buffer.alloc(32, 9).toString('base64');
