import type { MetadataRoute } from 'next';
import { robotsRules } from '../server/seo';

/** /robots.txt: production only is indexed (APP_ENV is read at request time, not at build). */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return robotsRules(process.env.APP_ENV, process.env.PUBLIC_BASE_URL?.trim());
}
