import type { TaskRow } from '@texholiday/admin';
import { takeTaskAction, resolveTaskAction } from '../../app/yonetim/(panel)/gorevler/actions';
import { adminDict, type AdminLocale } from '../../i18n/admin';
import { formatAdminInstant } from '../../server/admin-forms';
import { ActionForm } from './ActionForm';

/** Tasks with what to do and, for tasks.manage holders, take/close actions. */
export function TaskList({ tasks, locale, canManage, names, showOrder, meId }: { tasks: TaskRow[]; locale: AdminLocale; canManage: boolean; names: Map<string, string>; showOrder: boolean; meId: string }) {
  const t = adminDict(locale);
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <li key={task.id} className={`task ${task.status === 'OPEN' ? 'open' : 'closed'}`} data-testid="task">
          <div className="task-head">
            <strong>{t.tasks.reasons[task.reason] ?? task.reason}</strong>
            <span className={`tag ${task.status === 'OPEN' ? 'warn' : 'ok'}`}>{task.status === 'OPEN' ? t.tasks.open : t.tasks.resolved}</span>
          </div>
          {t.tasks.hints[task.reason] && task.status === 'OPEN' && <p className="hint">{t.tasks.hints[task.reason]}</p>}
          <p className="muted small-text">{task.detail}</p>
          <p className="small-text">
            {showOrder && (
              <>
                {t.tasks.order}: <a href={`/yonetim/siparisler/${task.orderId}`}>{task.orderId.slice(0, 8)}</a> ·{' '}
              </>
            )}
            {t.tasks.created}: {formatAdminInstant(task.createdAt, locale)} · {t.tasks.assignee}: {task.assignee ? (names.get(task.assignee) ?? task.assignee) : t.tasks.nobody}
            {task.resolvedAt && (
              <>
                {' '}
                · {t.tasks.resolvedAt}: {formatAdminInstant(task.resolvedAt, locale)}
              </>
            )}
          </p>
          {task.resolution && <p className="ok-box small-text">{task.resolution}</p>}
          {canManage && task.status === 'OPEN' && (
            <div className="task-actions">
              {task.assignee !== meId && (
                <ActionForm action={takeTaskAction} submit={t.tasks.take} variant="secondary" className="inline-form">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="orderId" value={task.orderId} />
                </ActionForm>
              )}
              <ActionForm action={resolveTaskAction} submit={t.tasks.resolve} className="stack">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="orderId" value={task.orderId} />
                <div className="field">
                  <label htmlFor={`res-${task.id}`}>{t.tasks.resolution}</label>
                  <textarea id={`res-${task.id}`} name="resolution" required minLength={5} maxLength={1000} />
                </div>
              </ActionForm>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
