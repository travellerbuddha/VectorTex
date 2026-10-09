import { TaskList } from '../../../../components/admin/TaskList';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, can, requireStaff } from '../../../../server/admin';
import { actorOf } from '../../../../server/admin-forms';

export const dynamic = 'force-dynamic';

export default async function Tasks({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'orders.view')) return <p className="notice">{t.noAccess}</p>;
  const closed = (await searchParams).durum === 'kapanmis';
  const { orders, auth } = admin();
  const [tasks, accounts] = await Promise.all([orders.tasks(actorOf(staff), closed ? 'RESOLVED' : 'OPEN'), auth.accounts()]);
  return (
    <div>
      <h1>{t.tasks.title}</h1>
      <p className="muted">{t.tasks.intro}</p>
      <nav className="tabs" aria-label={t.tasks.title}>
        <a href="/yonetim/gorevler" aria-current={!closed ? 'page' : undefined}>
          {t.tasks.open}
        </a>
        <a href="/yonetim/gorevler?durum=kapanmis" aria-current={closed ? 'page' : undefined}>
          {t.tasks.resolved}
        </a>
      </nav>
      {tasks.length === 0 ? (
        <p className="card">{t.tasks.none}</p>
      ) : (
        <TaskList tasks={tasks} locale={locale} canManage={can(staff, 'tasks.manage')} names={new Map(accounts.map((a) => [a.id, a.displayName]))} showOrder meId={staff.id} />
      )}
    </div>
  );
}
