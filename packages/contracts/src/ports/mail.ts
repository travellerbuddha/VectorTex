/**
 * Outgoing e-mail port. Implementations (SMTP, the MOCK directory mailer of tests) live outside the domain; a message
 * body may hold personal data or one-time links, so it is never logged or stored.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** `delivered: false` covers refusals and lost answers alike; the caller decides whether to retry. */
export type MailResult = { delivered: true } | { delivered: false; reason: string };

export interface Mailer {
  readonly kind: 'SMTP' | 'MOCK';
  send(message: MailMessage): Promise<MailResult>;
}
