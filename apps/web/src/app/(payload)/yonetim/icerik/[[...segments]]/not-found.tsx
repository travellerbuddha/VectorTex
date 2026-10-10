import { NotFoundPage, generatePageMetadata } from '@payloadcms/next/views';
import config from '../../../../../payload.config';
import { importMap } from '../importMap.js';

type Args = { params: Promise<{ segments: string[] }>; searchParams: Promise<{ [key: string]: string | string[] }> };

export const generateMetadata = ({ params, searchParams }: Args) => generatePageMetadata({ config, params, searchParams });

export default function CmsNotFound({ params, searchParams }: Args) {
  return NotFoundPage({ config, params, searchParams, importMap });
}
