import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig } from 'payload';
import { chainProblem, normalizeSitePath, redirectProblem } from '../../server/redirects';
import { anyone, publishers } from '../access';

/**
 * Old-site address map (P17). A saved rule is live at once (no drafts), so only `content.publish` may create, change or
 * delete rules; everyone may read them (the proxy serves them to every visitor anyway). Addresses are stored in their
 * canonical form; chains and loops are refused when saving.
 */
const normalizeAndCheck: CollectionBeforeValidateHook = async ({ data, req, originalDoc, collection }) => {
  if (!data) return data;
  const merged = { from: data.from ?? originalDoc?.from, to: data.to ?? originalDoc?.to };
  const fail = (field: 'from' | 'to', message: string) => {
    throw new ValidationError({ collection: collection.slug, errors: [{ path: field, message }], req });
  };
  const problem = redirectProblem(merged);
  if (problem) fail(problem.field, problem.message);
  const from = normalizeSitePath(merged.from as string)!;
  const to = normalizeSitePath(merged.to as string)!;
  const others = await req.payload.find({
    collection: 'redirects',
    where: { or: [{ from: { equals: to } }, { to: { equals: from } }, { from: { equals: from } }] },
    limit: 10,
    depth: 0,
    overrideAccess: true,
    req,
  });
  const rest = others.docs.filter((d) => d.id !== originalDoc?.id).map((d) => ({ from: String(d.from), to: String(d.to) }));
  if (rest.some((o) => o.from === from)) fail('from', `${from} için zaten bir yönlendirme var.`);
  const chain = chainProblem({ from, to }, rest);
  if (chain) fail(chain.field, chain.message);
  return { ...data, from, to };
};

export const Redirects: CollectionConfig = {
  slug: 'redirects',
  labels: { singular: { tr: 'Yönlendirme', en: 'Redirect' }, plural: { tr: 'Yönlendirmeler (eski adresler)', en: 'Redirects (old addresses)' } },
  admin: {
    useAsTitle: 'from',
    defaultColumns: ['from', 'to', 'status', 'updatedAt'],
    description: {
      tr: 'Eski sitedeki bir adres yeni sitede değiştiyse buraya ekleyin; ziyaretçi ve arama motorları kalıcı olarak yeni adrese gider. Kayıt hemen yayına girer.',
      en: 'When an old-site address changed on the new site, add it here; visitors and search engines go to the new address permanently. A rule is live as soon as it is saved.',
    },
  },
  access: { read: anyone, create: publishers, update: publishers, delete: publishers },
  hooks: { beforeValidate: [normalizeAndCheck] },
  fields: [
    {
      name: 'from',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 500,
      label: { tr: 'Eski adres', en: 'Old address' },
      admin: { description: { tr: 'Alan adı olmadan, "/" ile başlayan yol. Ör. /antalya-otelleri/', en: 'Path without the domain, starting with "/". E.g. /antalya-hotels/' } },
    },
    {
      name: 'to',
      type: 'text',
      required: true,
      maxLength: 500,
      label: { tr: 'Yeni adres', en: 'New address' },
      admin: { description: { tr: 'Bu sitedeki yol. Ör. /tr/antalya', en: 'Path on this site. E.g. /en/antalya' } },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: '301',
      options: [
        { value: '301', label: { tr: 'Kalıcı (301)', en: 'Permanent (301)' } },
        { value: '308', label: { tr: 'Kalıcı, yöntemi korur (308)', en: 'Permanent, keeps the method (308)' } },
      ],
      label: { tr: 'Tür', en: 'Type' },
    },
    { name: 'note', type: 'text', maxLength: 200, label: { tr: 'Not (kaynak, gerekçe)', en: 'Note (source, reason)' } },
  ],
};
