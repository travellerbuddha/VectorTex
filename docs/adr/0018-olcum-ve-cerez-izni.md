# ADR-0018 — Ölçüm (GTM/GA4), çerez izni ve Search Console

- Durum: Kabul edildi (2026-10-10).
- İlgili: P17 (SEO), ADR-0014 (otel liste sayfaları), ADR-0017 (müşteri hesabı), KVKK ve ePrivacy, Google Consent Mode v2.

## Bağlam

Reklam (Google Ads, Meta, Yandex) ve SEO çalışmaları ölçüm ister. Ölçümün iki koşulu var:
- Ziyaretçi izin vermeden analiz ve reklam çerezi yazılmamalı.
- Google'a giden her şeyde Consent Mode v2 sinyalleri doğru olmalı. Avrupa'dan gelen trafik için Google Ads bunları zorunlu tutar.

Etiket kimlikleri (GTM, GA4, Search Console) henüz yok. Site bu kimlikler olmadan da çalışmalı, kimlik girilince kod değişikliği olmadan devreye girmeli.

## Karar

**Ayarlar panelde:**
- Yer: "Ölçüm ve çerez ayarları" (`tracking-settings`, Payload global, `cms` şeması). Değiştirmek için yayın yetkisi gerekir.
- Alanlar:
  - GTM kapsayıcı kimliği (`GTM-…`);
  - yalnız GTM yoksa GA4 ölçüm kimliği (`G-…`);
  - izin modu;
  - Search Console doğrulama kodu;
  - bant metni (TR/EN);
  - çerez politikası adresi.
- Biçimi tutmayan kimlik kaydedilmez.
- Sayfa, ayarı istek başına okur. Ayar okunamazsa (ör. migration uygulanmamışsa) site etiketsiz çalışır.

**Kimlik yoksa hiçbir şey yüklenmez:** bant çıkmaz, `dataLayer` oluşmaz, dışarıya istek gitmez.

**Önerilen yol GTM'dir:**
- GA4, Google Ads dönüşümleri, Meta Pixel ve Yandex Metrica GTM içinden yönetilir.
- GTM girildiyse GA4 kimliği yok sayılır. Aynı olay iki kez sayılmaz.

**Consent Mode v2:**
- Her etiketten önce satır içi bir betik çalışır. Bu betik:
  - tüm Google amaçlarını `denied` yapar (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`);
  - `ads_data_redaction` ve `url_passthrough` ayarlarını açar;
  - ziyaretçinin kayıtlı seçimini hemen uygular.
- İki izin modu var:
  - **Temel (varsayılan):** GTM/GA4 yalnız analiz ya da pazarlama izni verilince yüklenir. En temkinli seçenektir.
  - **Gelişmiş:** etiketler hemen, `denied` durumunda yüklenir; Google çerezsiz ölçüm ve modelleme yapar.
- Hangi modun seçileceğine hukuk/KVKK danışmanıyla karar verilir. Kod varsayılanı temkinli olandır.

**Çerez bandı:**
- "Tümünü kabul et" ve "Reddet" eşit ağırlıktadır. "Tercihler"den analiz ve pazarlama ayrı seçilir.
- Seçim birinci taraf `th_consent` çerezinde 180 gün saklanır (`{a, m, v, t}`, SameSite=Lax, https'te Secure).
- Alt bilgideki "Çerez tercihleri" bağlantısı bandı yeniden açar.
- Her seçim `dataLayer`'a `consent_update` olayı olarak da gider. GTM'deki Meta ve Yandex etiketleri bu olaya ve izin durumuna bağlanır.

**GA4 e-ticaret olayları:**

| Sayfa | Olay |
| --- | --- |
| Arama sonucu | `search`, `view_item_list` |
| Liste sayfası | `view_item_list` |
| Otel sayfası | `view_item` |
| Rezervasyon formu | `begin_checkout` |
| Ödeme | `add_payment_info` |
| Onay | `purchase` (`transaction_id` = sipariş numarası) |

- `purchase` ve `add_payment_info` aynı tarayıcıdan bir kez gönderilir. Onay sayfası yenilenince satış iki kez sayılmaz.
- Olaylarda kişisel veri yoktur: yalnız otel kimliği ve adı, pansiyon, para birimi ve tutar. Ad, e-posta ve telefon gönderilmez.
- Tutar analiz için sayıdır (ana birim). Para hesabında kullanılmaz; para `Money` olarak kalır.

**Search Console:** doğrulama kodu girilirse her sayfada `<meta name="google-site-verification">` çıkar.

**CSP:** Google Tag Manager/Analytics/Ads, Meta ve Yandex etiket alan adları `script-src`, `connect-src` ve `frame-src`'ye eklendi. Etiketler ancak izin ve kimlikle yüklendiği için bu izin tek başına bir şey yüklemez.

## Sonuçlar

- Kimlikler girilene kadar site ölçümsüz, bantsız çalışır. Kimlik girilince kod değişikliği gerekmez.
- Çerez bandı metni ve politika bağlantısı hukuk onayından geçmelidir. Varsayılan metin yalnız başlangıç içindir.
- GTM içindeki etiket kurulumu (GA4 yapılandırması, Ads dönüşümü, Meta/Yandex) GTM arayüzünde yapılır. Etiketlerin izin ayarları "ek izin gerekli" olarak kurulmalıdır.
- Test: `apps/web/test/tracking.test.ts` (varsayılan izinler, kayıtlı seçim, olay yükleri) ve `apps/web/e2e/analytics.spec.ts`. E2E'de etiket dosyası yerelde yanıtlanır, dışarıya istek gitmez:
  - bant;
  - ret;
  - footer'dan yeniden açma;
  - yalnız analiz izni;
  - GTM'nin izinden sonra yüklenmesi;
  - Search Console etiketi;
  - arama→ödeme→onay olayları;
  - kişisel veri yokluğu;
  - tekrar sayılmama.

## 2. sürüm (2026-10-10): kurulumun tamamlanması

İşletme, ölçümün "nasıl olması gerekiyorsa" kurulmasını istedi. Bu sürümde verilen kararlar:

- **İzin modu Temel olarak sabitlendi (varsayılan ve önerilen).**
  - KVKK çerez rehberi, analiz ve pazarlama çerezleri için açık rıza ister.
  - Temel modda izin verilmeden Google, Meta ve Yandex'e hiçbir istek gitmez.
  - Gelişmiş mod panelde seçilebilir ama hazır kapsayıcı Temel moda göredir.
- **Çerez politikası sayfası:**
  - Adresler: `/tr/cerez-politikasi`, `/en/cookie-policy`.
  - Sayfa, koddaki tek çerez listesinden (`cookie-registry.ts`) üretilir: zorunlu, analiz ve pazarlama çerezleri; sağlayıcı, amaç ve süre ile.
  - Yurt dışına aktarım bilgisi ve tercih değiştirme düğmesi sayfadadır.
  - Bant ve footer her zaman bu sayfaya bağlanır. Panel alanı artık şirketin gizlilik/KVKK aydınlatma metni içindir.
- **İzin olayları:**
  - Kayıtlı izin her sayfa açılışında `consent_state` olayıyla, yeni seçim `consent_update` olayıyla duyurulur.
  - İki olay da `consent_analytics` ve `consent_marketing` alanlarını taşır.
- **Hazır GTM kapsayıcısı** (`docs/olcum/gtm-texholiday.json`):
  - İçerik: GA4 (e-ticaret ve `search`), Google Ads (Google tag, dönüşüm bağlayıcı, satın alma dönüşümü), Meta Pixel (PageView, InitiateCheckout, Purchase), Yandex Metrica (Webvisor kapalı).
  - Hiçbir etiket "Tüm sayfalar" ile çalışmaz. Analiz etiketleri analiz iznine, Ads ve Meta pazarlama iznine bağlıdır.
  - Kimlikler `CONFIG - …` yer tutucusudur.
  - Biçim, açık kaynak içe aktarma şablonlarının en küçük biçimine göre yazıldı. Google'ın belgelediği bir şema değildir; ilk kullanımda GTM önizlemesiyle doğrulanmalıdır (rehber §2).
  - `apps/web/test/gtm-container.test.ts` kapsayıcıyı koda bağlar: olay adları, izin alanları, tetikleyici ve değişken başvuruları, izinsiz etiket olmaması, yalnız yer tutucu kimlikler.
- **Doğrulama etiketleri:** Search Console'a ek olarak Yandex Webmaster ve Meta alan adı doğrulama kodları da panelden girilir.
- **İzinsiz kayıt yok:** satın almanın iki kez sayılmasını önleyen tarayıcı kaydı (`th_evt_…`) yalnız izin varsa yazılır.
- **CSP:** Yandex'in Türkiye alan adı (`mc.yandex.com.tr`) eklendi.
- **Kurulum rehberi:** `docs/olcum/OLCUM-KURULUMU.md`. Hesaplarda yapılacak işler orada: GTM içe aktarma, kimliklerin nereden alınacağı, GA4 istenmeyen yönlendirmeler, Ads dönüşümü, doğrulamalar.
