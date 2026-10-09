/** Error codes exposed in the public API error body (§14). Messages never contain provider internals or PII. */
export type ApiErrorCode =
  | 'CAPABILITY_NOT_AVAILABLE'
  | 'QUOTE_CHANGED'
  | 'QUOTE_EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_UNRESOLVED'
  | 'ILLEGAL_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONTRACT_NOT_PINNED'
  | 'POLICY_NOT_APPROVED';

export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly action: string | null;
  constructor(code: ApiErrorCode, message: string, opts: { httpStatus: number; retryable?: boolean; action?: string | null }) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
    this.action = opts.action ?? null;
  }
}

export class CapabilityNotAvailableError extends DomainError {
  readonly reasons: readonly string[];
  constructor(message: string, reasons: readonly string[]) {
    super('CAPABILITY_NOT_AVAILABLE', message, { httpStatus: 422, action: 'CHOOSE_ANOTHER_OPTION' });
    this.reasons = reasons;
  }
}

export class ContractNotPinnedError extends DomainError {
  readonly sourceIds: readonly string[];
  constructor(connectorId: string, sourceIds: readonly string[]) {
    super('CONTRACT_NOT_PINNED', `${connectorId} cannot run: required provider contracts are not pinned`, { httpStatus: 422 });
    this.sourceIds = sourceIds;
  }
}

export class IllegalTransitionError extends DomainError {
  constructor(machine: string, from: string, to: string) {
    super('ILLEGAL_TRANSITION', `${machine}: ${from} -> ${to} is not allowed`, { httpStatus: 409 });
  }
}

export class VersionConflictError extends DomainError {
  constructor(entity: string, id: string) {
    super('VERSION_CONFLICT', `${entity} ${id} was changed concurrently`, { httpStatus: 409, retryable: true, action: 'RELOAD' });
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor() {
    super('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different request', { httpStatus: 409 });
  }
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  retryable: boolean;
  action: string | null;
}

export function toApiError(err: DomainError, requestId: string): ApiErrorBody {
  return { code: err.code, message: err.message, requestId, retryable: err.retryable, action: err.action };
}
