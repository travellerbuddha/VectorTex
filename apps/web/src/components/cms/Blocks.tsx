import { SearchForm } from '../SearchForm';
import { countryOptions } from '../../i18n/countries';
import type { Locale } from '../../i18n/dictionaries';
import { RichText, safeHref } from './RichText';

/** Approved page blocks (payload/blocks.ts) rendered on the site. Unknown block types render nothing. */

type Media = { url?: string | null; alt?: string | null; width?: number | null; height?: number | null } | number | string | null | undefined;
type Rel<T> = T | number | string | null | undefined;
type Block = Record<string, unknown> & { blockType: string; id?: string | null };

function Img({ media, className, priority }: { media: Media; className?: string; priority?: boolean }) {
  if (!media || typeof media !== 'object' || !media.url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CMS images (local or S3) with their stored size
    <img src={media.url} alt={media.alt ?? ''} width={media.width ?? undefined} height={media.height ?? undefined} className={className} loading={priority ? 'eager' : 'lazy'} />
  );
}

const resolved = <T,>(list: unknown): T[] => (Array.isArray(list) ? (list.filter((x) => x && typeof x === 'object') as T[]) : []);

export interface BlockContext {
  locale: Locale;
  currencies: readonly string[];
  today: string;
  /** Hotel search prefill (destination pages). */
  place?: { placeId: string; name: string } | null;
}

export function Blocks({ blocks, ctx }: { blocks: unknown; ctx: BlockContext }) {
  const list = Array.isArray(blocks) ? (blocks as Block[]) : [];
  return (
    <>
      {list.map((b, i) => (
        <BlockView key={b.id ?? i} block={b} ctx={ctx} first={i === 0} />
      ))}
    </>
  );
}

function BlockView({ block, ctx, first }: { block: Block; ctx: BlockContext; first: boolean }) {
  switch (block.blockType) {
    case 'hero':
      return (
        <section className="cms-hero" data-block="hero">
          <Img media={block.image as Media} className="cms-hero-image" priority={first} />
          <div className="cms-hero-text">
            {first ? <h1>{String(block.heading ?? '')}</h1> : <h2>{String(block.heading ?? '')}</h2>}
            {typeof block.subheading === 'string' && block.subheading && <p>{block.subheading}</p>}
          </div>
          {block.showHotelSearch === true && (
            <SearchForm
              locale={ctx.locale}
              currencies={ctx.currencies as string[]}
              countries={countryOptions(ctx.locale)}
              today={ctx.today}
              initial={ctx.place ? { place: { placeId: ctx.place.placeId, name: ctx.place.name, address: '' } } : undefined}
            />
          )}
        </section>
      );
    case 'richText':
      return (
        <section className="cms-text" data-block="richText">
          <RichText data={block.content} />
        </section>
      );
    case 'imageText':
      return (
        <section className={`cms-image-text ${block.imagePosition === 'right' ? 'image-right' : ''}`} data-block="imageText">
          <Img media={block.image as Media} />
          <div>
            {typeof block.heading === 'string' && block.heading && <h2>{block.heading}</h2>}
            {typeof block.text === 'string' && block.text && <p>{block.text}</p>}
          </div>
        </section>
      );
    case 'faqList': {
      const faqs = resolved<{ id: string | number; question?: string; answer?: unknown }>(block.faqs);
      return (
        <section className="cms-faq" data-block="faqList">
          {typeof block.heading === 'string' && block.heading && <h2>{block.heading}</h2>}
          {faqs.map((f) => (
            <details key={f.id}>
              <summary>{f.question}</summary>
              <RichText data={f.answer} />
            </details>
          ))}
        </section>
      );
    }
    case 'destinationGrid': {
      const items = resolved<{ id: string | number; name?: string; slug?: string; summary?: string; heroImage?: Media }>(block.destinations);
      return (
        <section className="cms-destinations" data-block="destinationGrid">
          {typeof block.heading === 'string' && block.heading && <h2>{block.heading}</h2>}
          <ul>
            {items
              .filter((d) => d.slug)
              .map((d) => (
                <li key={d.id}>
                  <a href={`/${ctx.locale}/destinations/${d.slug}`}>
                    <Img media={d.heroImage} />
                    <strong>{d.name}</strong>
                    {d.summary && <span>{d.summary}</span>}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      );
    }
    case 'campaignBanner': {
      const c = block.campaign as Rel<{ title?: string; summary?: string; image?: Media; linkPath?: string | null; validFrom?: string | null; validTo?: string | null }>;
      if (!c || typeof c !== 'object') return null;
      const now = Date.now();
      if ((c.validFrom && Date.parse(c.validFrom) > now) || (c.validTo && Date.parse(c.validTo) < now)) return null;
      const body = (
        <>
          <Img media={c.image} />
          <div>
            <strong>{c.title}</strong>
            {c.summary && <p>{c.summary}</p>}
          </div>
        </>
      );
      return (
        <section className="cms-campaign" data-block="campaignBanner">
          {c.linkPath ? <a href={safeHref(c.linkPath)}>{body}</a> : body}
        </section>
      );
    }
    default:
      return null;
  }
}
