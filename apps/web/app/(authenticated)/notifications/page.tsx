import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { NotificationLink } from '@/components/notification-link';
import { getAccessToken } from '@/lib/server/auth-session';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/server/control-plane';

async function markRead(formData: FormData) {
  'use server';
  const token = await getAccessToken(); if (token === null) redirect('/login');
  const id = formData.get('notificationId'); if (typeof id === 'string') await markNotificationRead(token, id);
  revalidatePath('/notifications');
}
async function markAllRead() {
  'use server';
  const token = await getAccessToken(); if (token === null) redirect('/login');
  await markAllNotificationsRead(token, new Date().toISOString()); revalidatePath('/notifications');
}

export default async function NotificationInboxPage({ searchParams }: { searchParams: Promise<{ unread?: string; severity?: string }> }) {
  const token = await getAccessToken(); if (token === null) redirect('/login');
  const filters = await searchParams; const query = new URLSearchParams({ limit: '100' });
  if (filters.unread === 'true') query.set('unread', 'true');
  if (['info', 'warning', 'error', 'critical'].includes(filters.severity ?? '')) query.set('severity', filters.severity!);
  const result = await listNotifications(token, query.toString());
  const actionRequired = result.items.filter((item) => item.status === 'active');
  const other = result.items.filter((item) => item.status !== 'active');
  const renderItems = (items: typeof result.items) => items.map((item) => (
    <article className={`panel notification-card severity-${item.severity}`} key={item.id}>
      <div><p className="eyebrow">{item.workspace.name} · {item.severity}</p><h3>{item.summary.title}</h3>
        <p>{item.summary.body}</p><p className="metadata">{new Date(item.deliveredAt).toLocaleString()}
          {item.status === 'resolved' ? ' · Resolved' : ''}</p>
        <NotificationLink target={item.actionTarget} label={item.summary.actionLabel} /></div>
      {item.readAt === null ? <form action={markRead}><input type="hidden" name="notificationId" value={item.id} />
        <button className="secondary-button" type="submit">Mark read</button></form> : null}
    </article>
  ));
  return <main className="dashboard-page"><nav><Link href="/workspaces">Workspaces</Link></nav>
    <section className="page-heading"><p className="eyebrow">Operational alerts</p><h1>Notification Inbox</h1>
      <p>Safe operational summaries only. Opening a target still applies its normal authorization checks.</p></section>
    <section className="notification-toolbar"><Link href="/notifications">All</Link><Link href="/notifications?unread=true">Unread</Link>
      {['info','warning','error','critical'].map((severity) => <Link key={severity} href={`/notifications?severity=${severity}`}>{severity}</Link>)}
      <form action={markAllRead}><button className="secondary-button" type="submit">Mark all read</button></form></section>
    {actionRequired.length > 0 ? <section><h2>Action required</h2><div className="notification-list">{renderItems(actionRequired)}</div></section> : null}
    <section><h2>{actionRequired.length > 0 ? 'Other notifications' : 'Notifications'}</h2>
      <div className="notification-list">{renderItems(other)}</div>{result.items.length === 0 ? <p className="empty-state">No notifications match these filters.</p> : null}</section>
  </main>;
}
