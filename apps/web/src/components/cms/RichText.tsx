import { RichText as LexicalRichText, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react';

/** Only web, mail and phone links or site paths; anything else (javascript:, data:) becomes inert. */
export function safeHref(url: unknown): string {
  const u = typeof url === 'string' ? url.trim() : '';
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(u) ? u : '#';
}

type LinkNode = { fields: { url?: string; newTab?: boolean; linkType?: string } };

const converters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,
  link: ({ node, nodesToJSX }) => {
    const n = node as unknown as LinkNode & { children: unknown[] };
    const external = n.fields.newTab === true;
    return (
      <a href={n.fields.linkType === 'internal' ? '#' : safeHref(n.fields.url)} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {nodesToJSX({ nodes: n.children as never })}
      </a>
    );
  },
  autolink: ({ node, nodesToJSX }) => {
    const n = node as unknown as LinkNode & { children: unknown[] };
    return <a href={safeHref(n.fields.url)}>{nodesToJSX({ nodes: n.children as never })}</a>;
  },
});

/** Rich text from the CMS (Lexical JSON) as HTML elements; never raw HTML. */
export function RichText({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  return <LexicalRichText data={data as never} converters={converters} className="rich-text" />;
}
