import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPayload, type Payload } from 'payload';
import { adminSettingsFromEnv, base32Decode, hotp, StaffAuthService, totpStep } from '@texholiday/admin';
import type { StaffActor } from '@texholiday/contracts';
import { PermissionRepository, PolicyRepository } from '@texholiday/db';
import { money } from '@texholiday/pricing';
import config from '../payload.config';
import { CMS_USERS } from '../payload/access';
import { mirrorCmsUser } from '../payload/staff-strategy';
import { booking } from '../server/booking';
import { coreDatabase } from '../server/core';

/**
 * LOCAL DEMO data (docs/demo/LOKAL-DEMO.md), run by `pnpm demo` on a fresh demo database. Refused anywhere but a
 * development app on the MOCK or SANDBOX provider: the pricing policy, list settings, texts and orders written here are
 * DEMO values, never business decisions (G06). Accounts and their authenticator secrets go to DEMO_STATE_DIR only.
 */
const env = process.env;
if (env.APP_ENV !== 'development' || !['mock', 'sandbox'].includes(env.PROVIDER_ENV ?? '')) {
  console.error('demo-seed: only for APP_ENV=development with PROVIDER_ENV=mock or sandbox');
  process.exit(2);
}
const stateDir = env.DEMO_STATE_DIR;
const password = env.DEMO_STAFF_PASSWORD;
if (!stateDir || !password || password.length < 12) {
  console.error('demo-seed: DEMO_STATE_DIR and DEMO_STAFF_PASSWORD (12+ characters) are required');
  process.exit(2);
}
const provider = env.PROVIDER_ENV as 'mock' | 'sandbox';
const log = (msg: string) => console.log(`  • ${msg}`);

// ------------------------------------------------------------------ helpers

const paragraph = (text: string) => ({ type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', textFormat: 0, children: [{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] });
const heading = (text: string) => ({ type: 'heading', tag: 'h2', format: '', indent: 0, version: 1, direction: 'ltr', children: [{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] });
const richText = (...blocks: Array<string | { h: string }>) => ({
  root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: blocks.map((b) => (typeof b === 'string' ? paragraph(b) : heading(b.h))) },
});

interface DemoAccount {
  key: string;
  email: string;
  displayName: string;
  role: string;
  secret: string;
}

// ------------------------------------------------------------------ staff

async function staffAccounts(): Promise<{ accounts: DemoAccount[]; owner: StaffActor; finance: StaffActor; approver: StaffActor; ops: StaffActor; editor: { id: string; email: string; displayName: string } }> {
  const { db } = coreDatabase();
  const auth = new StaffAuthService(db, adminSettingsFromEnv(env));
  const perms = new PermissionRepository(db);
  const accounts: DemoAccount[] = [];
  const finish = async (key: string, token: string, staffId: string, email: string, displayName: string, role: string) => {
    const setup = await auth.completeSetup(token, password!);
    const { secret } = await auth.beginEnrollment(setup.token);
    await auth.completeEnrollment(setup.token, hotp(base32Decode(secret), totpStep(new Date())));
    accounts.push({ key, email, displayName, role, secret });
    return staffId;
  };
  const boot = await auth.bootstrapOwner({ email: 'yonetici@demo.texholiday.test', displayName: 'Demo Yönetici' });
  const owner: StaffActor = { kind: 'STAFF', id: boot.staffId };
  await finish('yonetici', boot.token, boot.staffId, 'yonetici@demo.texholiday.test', 'Demo Yönetici', 'Yönetici (tüm izinler)');
  const invite = async (key: string, email: string, displayName: string, role: 'FINANCE' | 'FINANCE_APPROVER' | 'CONTENT_EDITOR' | 'OPERATIONS', label: string) => {
    const inv = await auth.invite(owner, { email, displayName });
    await perms.grantRole(inv.staffId, role, owner);
    return finish(key, inv.token, inv.staffId, email, displayName, label);
  };
  const financeId = await invite('finans', 'finans@demo.texholiday.test', 'Demo Finans', 'FINANCE', 'Finans');
  const approverId = await invite('onay', 'onay@demo.texholiday.test', 'Demo Finans Onay', 'FINANCE_APPROVER', 'Finans onaycısı');
  const editorId = await invite('icerik', 'icerik@demo.texholiday.test', 'Demo İçerik', 'CONTENT_EDITOR', 'İçerik editörü');
  const opsId = await invite('operasyon', 'operasyon@demo.texholiday.test', 'Demo Operasyon', 'OPERATIONS', 'Operasyon');
  log(`${accounts.length} panel hesabı (parola ve doğrulama kodları .demo/hesaplar.json)`);
  return {
    accounts,
    owner,
    finance: { kind: 'STAFF', id: financeId },
    approver: { kind: 'STAFF', id: approverId },
    ops: { kind: 'STAFF', id: opsId },
    editor: { id: editorId, email: 'icerik@demo.texholiday.test', displayName: 'Demo İçerik' },
  };
}

/** DEMO pricing policy: drafted by finance, approved by a second person (four eyes), labelled as demo. */
async function demoPricingPolicy(finance: StaffActor, approver: StaffActor) {
  const policies = new PolicyRepository(coreDatabase().db);
  const draft = await policies.createDraft(
    'PRICING',
    env.POLICY_ID ?? 'b2c',
    {
      rounding: 'HALF_EVEN',
      rules: [
        { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 },
        {
          productType: 'FLIGHT',
          paymentMode: 'PROVIDER_MANAGED',
          application: 'PROVIDER_API',
          kind: 'PERCENT_OF_NET',
          basisPoints: 800,
          ancillaries: { seatsBasisPoints: 1000, bagsBasisPoints: 1000, penaltiesBasisPoints: null },
        },
      ],
      serviceFees: [],
      fx: null,
      allowBelowSspInOpaquePackage: false,
    },
    finance,
    'DEMO politikası: gerçek marj değildir (otel %10, uçak %8). Canlıda finans ekibi kendi değerlerini girer.',
  );
  await policies.approve('PRICING', env.POLICY_ID ?? 'b2c', draft.version, approver, 'Demo onayı');
  log('Demo fiyat politikası onaylandı (otel %10, uçak %8 — yalnız demo)');
}

// ------------------------------------------------------------------ content

async function contentUser(payload: Payload, editor: { id: string; email: string; displayName: string }) {
  const cmsUser = await mirrorCmsUser(payload, editor);
  return { ...cmsUser, collection: CMS_USERS, staffPermissions: ['content.edit', 'content.publish'] } as never;
}

async function create(payload: Payload, user: never, collection: 'hotel-lists' | 'posts' | 'faqs', tr: Record<string, unknown>, en: Record<string, unknown> | null) {
  const doc = await payload.create({ collection, data: { ...tr, _status: 'published' } as never, locale: 'tr', user, overrideAccess: false });
  if (en) await payload.update({ collection, id: doc.id, data: { ...en, _status: 'published' } as never, locale: 'en', user, overrideAccess: false });
  return doc;
}

async function placeOf(text: string, mustContain: RegExp): Promise<{ placeId: string; name: string; address: string } | null> {
  const { app } = await booking();
  const found = (await app.places(text, 'tr')).find((p) => mustContain.test(`${p.name} ${p.address}`));
  return found ? { placeId: found.placeId, name: found.name, address: found.address } : null;
}

async function hotelLists(payload: Payload, user: never) {
  await payload.updateGlobal({
    slug: 'hotel-list-settings',
    data: { trCurrency: 'EUR', trNationality: 'TR', enCurrency: 'EUR', enNationality: 'GB', maxPriceAgeHours: 26 } as never,
    user,
    overrideAccess: false,
  });
  const lists: Array<{ tr: Record<string, unknown>; en: Record<string, unknown> }> = [];
  const faq = {
    tr: [
      { question: 'Listedeki fiyatlar neyi kapsıyor?', answer: '1 oda, 2 yetişkin ve 1 gece içindir; önümüzdeki 30 günün en düşük fiyatıdır. Vergiler dahildir; otelde ayrıca ödenecek bir tutar varsa fiyatın yanında yazar.' },
      { question: 'Fiyat rezervasyonda değişebilir mi?', answer: 'Liste fiyatı gösterim içindir. Rezervasyonda fiyat sağlayıcıdan yeniden alınır ve ödemeden önce size gösterilir.' },
    ],
    en: [
      { question: 'What do the list prices cover?', answer: '1 room, 2 adults and 1 night; the lowest price of the next 30 days. Taxes included; any amount payable at the hotel is shown next to the price.' },
      { question: 'Can the price change when I book?', answer: 'List prices are for display. When you book, the price is fetched again and shown to you before you pay.' },
    ],
  };
  if (provider === 'mock') {
    const places = [
      { placeId: 'MOCK-PLACE-ANTALYA', name: 'Antalya (MOCK)', address: 'Antalya, Türkiye' },
      { placeId: 'MOCK-PLACE-BELEK', name: 'Belek (MOCK)', address: 'Serik, Antalya, Türkiye' },
    ];
    lists.push(
      {
        tr: { title: 'Antalya Otelleri', slug: 'antalya-otelleri', intro: 'Antalya merkez ve Belek’te seçtiğimiz oteller, önümüzdeki 30 günün en düşük fiyatlarıyla.', places, boardType: 'ANY', sort: 'TOP_PICKS', maxItems: 30, faq: faq.tr },
        en: { title: 'Antalya Hotels', slug: 'antalya-hotels', intro: 'Hotels we picked in Antalya and Belek, with the lowest prices of the next 30 days.', faq: faq.en },
      },
      {
        tr: { title: 'Her Şey Dahil Oteller', slug: 'her-sey-dahil-oteller', intro: 'Yeme içmenin fiyata dahil olduğu oteller.', places, boardType: 'AI', sort: 'PRICE', maxItems: 30, faq: faq.tr },
        en: { title: 'All-Inclusive Hotels', slug: 'all-inclusive-hotels', intro: 'Hotels where food and drinks are included.', faq: faq.en },
      },
      {
        tr: { title: 'Bütçe Dostu Oteller', slug: 'butce-dostu-oteller', intro: 'En uygun fiyatlı oteller, en düşükten başlayarak.', places, boardType: 'ANY', sort: 'PRICE', maxItems: 30, faq: faq.tr },
        en: { title: 'Budget-Friendly Hotels', slug: 'budget-friendly-hotels', intro: 'The best-value hotels, lowest price first.', faq: faq.en },
      },
    );
  } else {
    const antalya = await placeOf('Antalya', /Antalya/i);
    const egypt = await placeOf('Mısır', /Mısır|Egypt|Misir/i);
    const rome = await placeOf('Roma', /İtalya|Italy|Italia/i);
    if (antalya) {
      lists.push(
        {
          tr: { title: 'Antalya Otelleri', slug: 'antalya-otelleri', intro: 'Antalya’da seçtiğimiz oteller, önümüzdeki 30 günün en düşük fiyatlarıyla.', places: [antalya], pinned: ['lp36ea1', 'lp8ad18'], boardType: 'ANY', sort: 'TOP_PICKS', maxItems: 30, faq: faq.tr },
          en: { title: 'Antalya Hotels', slug: 'antalya-hotels', intro: 'Hotels we picked in Antalya, with the lowest prices of the next 30 days.', faq: faq.en },
        },
        {
          tr: { title: 'Her Şey Dahil Oteller', slug: 'her-sey-dahil-oteller', intro: 'Antalya’da yeme içmenin fiyata dahil olduğu oteller.', places: [antalya], boardType: 'AI', sort: 'PRICE', maxItems: 30, faq: faq.tr },
          en: { title: 'All-Inclusive Hotels', slug: 'all-inclusive-hotels', intro: 'Hotels in Antalya where food and drinks are included.', faq: faq.en },
        },
        {
          tr: { title: 'Bütçe Dostu Oteller', slug: 'butce-dostu-oteller', intro: 'Antalya’nın en uygun fiyatlı otelleri, en düşükten başlayarak.', places: [antalya], stars: ['3', '4'], boardType: 'ANY', sort: 'PRICE', maxItems: 30, faq: faq.tr },
          en: { title: 'Budget-Friendly Hotels', slug: 'budget-friendly-hotels', intro: 'The best-value hotels of Antalya, lowest price first.', faq: faq.en },
        },
      );
    }
    lists.push({
      tr: { title: 'Swandor Otelleri', slug: 'swandor-otelleri', intro: 'Swandor Hotels & Resorts otelleri.', include: ['lp36ea1', 'lp8ad18'], boardType: 'ANY', sort: 'MANUAL', maxItems: 10, faq: faq.tr },
      en: { title: 'Swandor Hotels', slug: 'swandor-hotels', intro: 'Hotels of Swandor Hotels & Resorts.', faq: faq.en },
    });
    if (egypt) {
      lists.push({
        tr: { title: 'Mısır Otelleri', slug: 'misir-otelleri', intro: 'Mısır’da seçtiğimiz oteller.', places: [egypt], boardType: 'ANY', sort: 'TOP_PICKS', maxItems: 30, faq: faq.tr },
        en: { title: 'Egypt Hotels', slug: 'egypt-hotels', intro: 'Hotels we picked in Egypt.', faq: faq.en },
      });
    }
    if (rome) {
      lists.push({
        tr: { title: 'Roma Otelleri', slug: 'roma-otelleri', intro: 'Roma’da seçtiğimiz oteller.', places: [rome], boardType: 'ANY', sort: 'TOP_PICKS', maxItems: 30, faq: faq.tr },
        en: { title: 'Rome Hotels', slug: 'rome-hotels', intro: 'Hotels we picked in Rome.', faq: faq.en },
      });
    }
  }
  for (const l of lists) await create(payload, user, 'hotel-lists', l.tr, l.en);
  log(`${lists.length} otel listesi yayında (${provider === 'mock' ? 'MOCK oteller' : 'Nuitee sandbox otelleri'})`);
}

async function guidesAndFaq(payload: Payload, user: never) {
  await create(
    payload,
    user,
    'posts',
    {
      title: 'Antalya’da nerede kalınır?',
      slug: 'antalyada-nerede-kalinir',
      excerpt: 'Lara, Konyaaltı, Belek, Kemer ve Side: Antalya bölgelerini tatil tarzınıza göre seçin. (Demo yazı)',
      publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      body: richText(
        { h: 'Lara ve Kundu' },
        'Havalimanına yakın, uzun kumsalı ve büyük her şey dahil otelleriyle aileler için uygundur.',
        { h: 'Belek' },
        'Golf sahaları ve geniş bahçeli resort otelleriyle bilinir.',
        { h: 'Kemer' },
        'Dağ ile denizin buluştuğu, koylarıyla sakin bir tatil bölgesidir.',
      ),
    },
    {
      title: 'Where to stay in Antalya',
      slug: 'where-to-stay-in-antalya',
      excerpt: 'Lara, Konyaaltı, Belek, Kemer and Side: pick the Antalya area that fits your holiday. (Demo article)',
      body: richText({ h: 'Lara and Kundu' }, 'Close to the airport, with a long sandy beach and large all-inclusive resorts.', { h: 'Belek' }, 'Known for golf courses and resorts with large gardens.', { h: 'Kemer' }, 'Where the mountains meet the sea: quiet bays and a calm holiday.'),
    },
  );
  await create(
    payload,
    user,
    'posts',
    {
      title: 'Her şey dahil tatilde bilmeniz gerekenler',
      slug: 'her-sey-dahil-tatil-rehberi',
      excerpt: 'Her şey dahil ile ultra her şey dahil arasındaki fark ve rezervasyonda dikkat edilecekler. (Demo yazı)',
      publishedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      body: richText('Her şey dahil konseptte yemekler ve çoğu içecek fiyata dahildir. Otelin dahil olmayan hizmetlerini (a la carte restoran, spa) rezervasyondan önce kontrol edin.'),
    },
    null,
  );
  const faqs: Array<{ category: string; tr: [string, string]; en: [string, string] }> = [
    { category: 'booking', tr: ['Rezervasyonum ne zaman kesinleşir?', 'Ödemeniz alındıktan sonra otel sağlayıcısı rezervasyonu onaylar; onay e-postası ve rezervasyon numarası size iletilir.'], en: ['When is my booking confirmed?', 'Once your payment is taken the hotel provider confirms the booking; you receive a confirmation e-mail with the booking number.'] },
    { category: 'payment', tr: ['Ödemeyi nasıl yaparım?', 'Kartınızla, sağlayıcımız Nuitee’nin güvenli ödeme alanında ödersiniz. Kart bilgileriniz bize ulaşmaz.'], en: ['How do I pay?', 'By card, in the secure payment form of our provider Nuitee. Your card details never reach us.'] },
    { category: 'payment', tr: ['Taksit yapılabiliyor mu?', 'Şu anda taksit seçeneği yoktur.'], en: ['Can I pay in instalments?', 'Instalments are not available at the moment.'] },
    { category: 'cancellation', tr: ['Rezervasyonumu iptal edebilir miyim?', 'İptal koşulları her fiyatın yanında yazar. Ücretsiz iptal süresi içindeki iptallerde ödediğiniz tutar kartınıza iade edilir.'], en: ['Can I cancel my booking?', 'The cancellation terms are shown next to each price. If you cancel within the free cancellation period, the amount you paid is refunded to your card.'] },
  ];
  for (const f of faqs) await create(payload, user, 'faqs', { question: f.tr[0], answer: richText(f.tr[1]), category: f.category }, { question: f.en[0], answer: richText(f.en[1]) });
  log('2 rehber yazısı ve 4 SSS yayında');
}

async function menus(payload: Payload, user: never) {
  const items = [
    ['Oteller', '/tr/oteller', 'Hotels', '/en/hotels'],
    ['Seyahat rehberi', '/tr/rehber', 'Travel guide', '/en/guides'],
    ['SSS', '/tr/sss', 'FAQ', '/en/faq'],
  ] as const;
  const nav = await payload.updateGlobal({ slug: 'navigation', data: { items: items.map(([label, href]) => ({ label, href })) } as never, locale: 'tr', user, overrideAccess: false });
  const ids = ((nav as { items?: Array<{ id: string }> }).items ?? []).map((i) => i.id);
  await payload.updateGlobal({ slug: 'navigation', data: { items: items.map(([, , label, href], i) => ({ id: ids[i], label, href })) } as never, locale: 'en', user, overrideAccess: false });
  log('Menü bağlantıları (TR/EN)');
}

// ------------------------------------------------------------------ prices and orders (MOCK only)

async function mockScanAndOrders(ops: StaffActor, finance: StaffActor) {
  const { app, mock } = await booking();
  if (!mock) return;
  const steps = await app.hotelListScanner('demo-seed', { sleep: async () => {} }).runUntilIdle(2000);
  log(`Liste fiyatları tarandı (${steps} adım, 30 gün)`);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const order = async (key: string, checkin: string, nights: number, hotelId: string, holder: { firstName: string; lastName: string; email: string }) => {
    const r = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin, checkout: day(Math.round((Date.parse(checkin) - Date.now()) / 86_400_000) + nights), rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr' });
    const offer = r.hotels.find((h) => h.hotelId === hotelId)!.offers.find((o) => o.cancellation.refundable) ?? r.hotels.find((h) => h.hotelId === hotelId)!.offers[0]!;
    const quote = await app.selectOffer(r.sessionId, offer.key);
    const out = await app.createCheckout({
      quoteVersionId: quote.quoteVersionId,
      acceptTerms: true,
      termsVersion: env.TERMS_VERSION,
      holder: { ...holder, phone: '+905320000000' },
      roomGuests: [{ occupancyNumber: 1, firstName: holder.firstName, lastName: holder.lastName }],
      locale: 'tr',
      idempotencyKey: `demo-order-${key}`,
    });
    const session = await app.paymentSession(out.orderId, out.accessToken);
    if (session.state === 'READY') mock.hotels.markPaid(session.secretKey.replace('MOCK_secret_', ''));
    await app.finalize(out.orderId, out.accessToken);
    return out.orderId;
  };
  await order('1', day(20), 3, 'MOCK-H1', { firstName: 'Ayşe', lastName: 'Demir', email: 'ayse.demir@ornek.test' });
  await order('2', day(35), 5, 'MOCK-H2', { firstName: 'John', lastName: 'Smith', email: 'john.smith@example.test' });
  const cancelled = await order('3', day(15), 2, 'MOCK-H2', { firstName: 'Mehmet', lastName: 'Kaya', email: 'mehmet.kaya@ornek.test' });
  await app.staff.cancel(ops, cancelled, 'Misafir telefonla iptal istedi (demo)', { customerAcceptedFee: true });
  await app.staff.recordProviderRefund(finance, cancelled, money('EUR', 9900n), 'Nuitee panel (demo)');
  log('3 örnek sipariş (2 onaylı, 1 iptal + iade kaydı)');
}

// ------------------------------------------------------------------ run

const payload = await getPayload({ config });
const staff = await staffAccounts();
await demoPricingPolicy(staff.finance, staff.approver);
const user = await contentUser(payload, staff.editor);
await hotelLists(payload, user);
await guidesAndFaq(payload, user);
await menus(payload, user);
if (provider === 'mock') await mockScanAndOrders(staff.ops, staff.finance);
else log('Liste fiyatlarını worker tarayacak (Nuitee sandbox, saniyede 1 çağrı; ilk fiyatlar birkaç dakikada görünür)');

mkdirSync(stateDir, { recursive: true });
writeFileSync(
  join(stateDir, 'hesaplar.json'),
  JSON.stringify({ note: 'YEREL DEMO hesapları — yalnız bu bilgisayar içindir.', password, provider, accounts: staff.accounts }, null, 2),
);
console.log('demo-seed: tamam');
process.exit(0);
