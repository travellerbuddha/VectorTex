import { notFound } from 'next/navigation';
import { booking } from '../../../../../server/booking';

/**
 * Checks the search session before the results stream: an unknown session answers 404 at once, and the loading frame
 * (loading.tsx, which wraps only the page) is shown for real searches only.
 */
export default async function ResultsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { app } = await booking();
  if (!(await app.searchCriteria(sessionId))) notFound();
  return children;
}
