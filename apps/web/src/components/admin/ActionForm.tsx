'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import type { FormState } from '../../server/admin-forms';

/**
 * A form posting to a server action and showing its result (success, error, or a one-time link to hand over).
 * `confirmText` asks before destructive actions. The action is dispatched by hand so that a rejected submission keeps
 * what the person typed (React resets a form after every `action` submission); the form is cleared only on success.
 */
export function ActionForm({
  action,
  submit,
  variant = 'primary',
  confirmText,
  className = 'stack',
  copyText,
  children,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submit: string;
  variant?: 'primary' | 'secondary' | 'danger';
  confirmText?: string;
  className?: string;
  copyText?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const linkRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && !state.error) formRef.current?.reset();
  }, [state]);
  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      <div className="actions">
        <button type="submit" className={variant} disabled={pending}>
          {submit}
        </button>
      </div>
      {state?.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="ok-box" role="status">
          {state.ok}
        </p>
      )}
      {state?.link && (
        <div className="ok-box">
          <input ref={linkRef} readOnly value={state.link.url} aria-label={state.link.note} data-testid="one-time-link" onFocus={(e) => e.currentTarget.select()} />
          <div className="actions">
            {copyText && (
              <button type="button" className="secondary small" onClick={() => void navigator.clipboard?.writeText(state.link!.url)}>
                {copyText}
              </button>
            )}
            <small>{state.link.note}</small>
          </div>
        </div>
      )}
    </form>
  );
}
