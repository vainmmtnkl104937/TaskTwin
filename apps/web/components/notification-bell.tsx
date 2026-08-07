import Link from 'next/link';
import { getAccessToken } from '@/lib/server/auth-session';
import { getNotificationUnreadCount, listNotifications } from '@/lib/server/control-plane';
import { NotificationLink } from './notification-link';

export async function NotificationBell() {
  const token = await getAccessToken();
  if (token === null) return null;
  let unread: Awaited<ReturnType<typeof getNotificationUnreadCount>>;
  let recent: Awaited<ReturnType<typeof listNotifications>>;
  try {
    [unread, recent] = await Promise.all([
      getNotificationUnreadCount(token), listNotifications(token, 'limit=5'),
    ]);
  } catch {
    return <Link href="/notifications" aria-label="Notifications">&#128276;</Link>;
  }
  return (
    <details className="notification-bell">
      <summary aria-label={`Notifications, ${unread.count} unread`}>
        <span aria-hidden="true">&#128276;</span>
        {unread.count > 0 ? <span className="notification-badge">{unread.count > 99 ? '99+' : unread.count}</span> : null}
      </summary>
      <section className="notification-dropdown" aria-label="Recent notifications">
        <h2>Notifications</h2>
        {recent.items.map((item) => <article key={item.id} className={item.readAt === null ? 'notification-unread' : undefined}>
          <strong>{item.summary.title}</strong><p>{item.summary.body}</p>
          <NotificationLink target={item.actionTarget} label={item.summary.actionLabel} />
        </article>)}
        {recent.items.length === 0 ? <p>No notifications.</p> : null}
        <Link href="/notifications">View notification inbox</Link>
      </section>
    </details>
  );
}
