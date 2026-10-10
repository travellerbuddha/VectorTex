# ADR-0014 — Otel liste sayfaları ve otel sayfaları (SEO, Google karuselleri, reklam açılış sayfası)

- Durum: Kabul edildi (2026-10-10).
- İlgili: ADR-0003 (Payload yalnız `cms`, Drizzle yalnız `core`), ADR-0006 (API marjı), ADR-0009 (SSP), P06, P17, K15, G06, R0 §11, Nuitee sorusu 23.

## Bağlam

İşletme, Enuygun ("En Uygun Antalya Otelleri", `/otel/bolge/antalya-481/`) ve Hotels.com (`/de1355047/antalya-turkiye-otelleri/`) gibi sayfalar istiyor:

- Bölgenin otelleri fiyatlarıyla listelenir.
- Panelden bölge veya otel kodu girilerek otel eklenir ve çıkarılır.
- Konsept listeleri yapılabilir: her şey dahil, bütçe dostu gibi.
- Sayfalar Google'da otel şeridiyle ve "Yer siteleri" bölümünde çıkabilmeli.
- Sayfalara reklam verilebilmeli.

İşletme kararları (2026-10-10):

- URL biçimi: SEO ve GEO (üretken arama motorları) için en uygunu.
- Listeleri işletme panelden kendisi kurar. İlk set: Antalya Otelleri, Mısır Otelleri, Roma Otelleri, Her Şey Dahil Oteller, Bütçe Dostu Oteller.
- Fiyat: önümüzdeki 30 günün en düşük fiyatı. Nuitee çağrı maliyeti gözetilir. Fiyatta hata olmamalı.
- Tek sağlayıcı Nuitee.

### Google'ın iki ayrı özelliği

Google Search Central belgeleri bu ortamdan açılamadı (ağ politikası). Aşağıdakiler arama sonuçlarından derlendi; yayından önce Rich Results Test ve Search Console ile doğrulanır.

1. **Yapılandırılmış veri karuselleri (beta).** Türkiye'de otel, tatil evi ve yerel işletme için açık.
   - Bir özet (liste) sayfası gerekir. Sayfada en üst düzeyde `ItemList` bulunur, her `ListItem` bir `Hotel` taşır.
   - Her öğenin `url`'si aynı alan adında **ayrı bir otel sayfasıdır**. Liste içindeki adresler birbirinden farklıdır.
   - Zorunlu alanlar: `name`, `image`, `url`. Otel için `priceRange` (12 karakterden kısa) ve `amenityFeature` istenir.
   - İşaretlenen bilgi sayfada görünür olmalıdır.
   - Gösterim garantisi yoktur.
2. **Yer siteleri (toplayıcı karuseli ve filtre çipi).** Yalnız Türkiye'de, otel ve yerel işletme aramalarında çıkar.
   - İşaretleme gerektirmez.
   - Google, sorguda organik olarak iyi sıralanan toplayıcı sitelerden seçer. Şartı iyi SEO'dur.

**Puanlar.** Google'ın inceleme kuralı başka sitelerden toplanan puanların işaretlenmesini yasaklar; ihlal manuel işlem sebebidir. Nuitee'nin otel puanı sayfada kaynağıyla gösterilir ama `aggregateRating` olarak **işaretlenmez**. Kendi misafir yorumlarımız olursa o zaman işaretlenir.

### Sandbox bulguları (R0 §11, 2026-10-10)

- `/hotels/rates` `placeId` ile bölgenin otellerini fiyatlarıyla döndürür (Antalya 38, Mısır 46 otel). `boardType: "AI"` filtresi yalnız her şey dahil fiyatları döndürür (Antalya 11 otel).
  - Bir çağrı 3,5–11 sn sürer ve 0,1–0,7 MB yanıt verir.
- `/data/hotels` `placeId` ile yerin merkezinin **1 km** çevresini arar (belge). Bölge listesi için uygun değildir; üyeler fiyat aramasından bulunur.
- `/data/hotel` dil parametresiyle Türkçe açıklama, 72 görsel, 96 olanak, giriş/çıkış saati ve konum döndürür.
  - Görseller `static.cupid.travel` üzerinden gelir.
  - Puan 10 üzerindendir, yorum sayısı da gelir.
- Yer araması belirsizdir:
  - "Rome" (EN) ilk sonuçta **Rome, Georgia (ABD)** getirdi; "Roma" (TR) Roma, İtalya'yı getirdi.
  - "Antalya" bir `locality`'dir; Belek, Kemer, Side ayrı yerlerdir.
  - Bu yüzden panel yerin adresini/ülkesini gösterir ve bir liste birden çok yer alabilir.
- `/hotels/min-rates` marj parametresi almaz. Onaylı politikamızın marjıyla fiyat vermediği için **kullanılmaz**.
- Hız sınırı: sandbox 5 istek/sn. Production için iki belge farklı sayı verir: 250 ve 500 istek/sn. Statik veri uçlarında sınır daha sıkıdır.
  - Arama çağrısı başına ücret veya bakma/satma oranı sınırı belgelenmemiştir (soru 23).

## Karar

Tasarım, uygulamadan önce bağımsız bir mimari incelemeden geçti. Aşağıdakiler inceleme sonrası halidir.

### 1. Adresler

Kısa, okunur ve sayfa dilinde adresler kullanılır. Her sayfa tipinin kendi dizini vardır: Search Console'da ayrı izlenir, sitemap'te ayrı yer alır, reklamda "URL şunu içerir" kuralıyla seçilir.

| Sayfa | Türkçe | İngilizce |
|---|---|---|
| Liste dizini | `/tr/oteller` | `/en/hotels` |
| Otel listesi | `/tr/oteller/{adres}` ör. `/tr/oteller/antalya` | `/en/hotels/{adres}` |
| Otel | `/tr/otel/{ad}-{otelKodu}` ör. `/tr/otel/akra-antalya-lp1897` | `/en/hotel/{ad}-{otelKodu}` |

- Liste adresini editör belirler (dil başına). UUID biçimindeki adresler reddedilir.
- Otel adresi addan üretilir (Türkçe harfler sadeleşir) ve sonuna Nuitee otel kodu eklenir. Adres, içerik önbelleğinde dil başına saklanır ve sayfa adresle bulunur.
  - Önbellekte olmayan otel 404 verir.
  - Otel sayfası istek üzerine sağlayıcıyı hiç çağırmaz; böylece tarayıcı (bot) trafiği maliyet yaratmaz.
- Her dizin iki dil için de çalışır ama yanlış dil 404 verir (`/en/oteller/…`, `/tr/hotel/…`).
- Arama sonuçları `/{dil}/hotels/{oturum}` adresinden `/{dil}/search/hotels/{oturum}` adresine taşındı.
  - Eski oturum adresi (UUID) 308 ile yeni adrese gider.
  - `robots.txt` artık `/{dil}/search/` dizinini kapatır; `/en/hotels/` açıktır.
- Dil sürümleri `hreflang` ile bağlanır; `x-default` Türkçe sürümdür. Canonical her zaman parametresiz adrestir.
- Next'in kalıcı yönlendirmesi 308'dir. Google 308'i 301 gibi değerlendirir.

### 2. Sorumluluklar (ADR-0003)

**İçerik (Payload, `cms`): `hotel-lists` koleksiyonu.**
- Dile göre alanlar: başlık, adres, giriş metni, gövde, SSS, SEO.
- Kaynak:
  - en çok 10 **yer**; yer, sitenin kendi önerisinden adres/ülkesiyle seçilir;
  - **eklenen**, **çıkarılan** ve **başa sabitlenen** otel kodları.
- Filtreler: yıldız, pansiyon tipi.
- Sıralama:
  - öne çıkanlar (sağlayıcı sırası);
  - fiyat ("bütçe dostu"; tutar alanı yoktur, CMS'te finansal alan bulunmaz);
  - elle sıra.
- Gösterilecek en çok otel sayısı.

**Fiyat ayarları: `hotel-list-settings` global'i.**
- Dil başına para birimi ve misafir uyruğu, fiyatın en fazla kaç saatlik olabileceği.
- Girilmeyen dilde fiyat gösterilmez ve tarama yapılmaz. Varsayılan konmaz.

**Aynalama.**
- Koleksiyonun `afterChange` kancası, yayın kaydı kesinleştikten sonra yayımlanmış sürümü yeniden okur ve `core.hotel_lists`'e yazar.
  - Bu yöntem taslak kaydı, yayından kaldırmayı ve sürüm geri yüklemeyi de doğru işler.
  - Yazılamazsa istek ve yayın geri alınır.
- Silme aynayı kapatır. Global'in `afterChange` kancası ayarları aynalar.
- Sayfa, CMS belgesinin `updatedAt` değeri aynadakiyle aynı değilse fiyat göstermez.

**Çekirdek (Drizzle, `core`).**
- Liste aynası ve ayarlar.
- **Kapsamlar.** Kapsam = yerler + otel kodları + pansiyon tipi + para birimi + uyruk + ortam. Aynı kapsamı paylaşan listeler tek taramayı paylaşır.
- **Gün satırları:** kapsam × giriş tarihi.
- **Gün fiyatları.**
- **Kalıcı üyeler.** Bir otel, son görüldüğünden itibaren 14 gün listede kalır; müsaitlik değiştikçe sayfalar dizine girip çıkmaz.
- **Sıra.** "Öne çıkanlar" sırası birden çok yerde yerler arasında dönüşümlüdür; ilk yerin otelleri listeyi doldurmaz.
- **Ortak çağrı hızı satırı.**
- **Otel içerik önbelleği** (ortam, dil ve adresle).

### 3. Fiyat: 30 günün en düşüğü, yalnız gösterim için

**Referans.**
- 1 oda, 2 yetişkin, 1 gece. Giriş tarihi yarından (Europe/Istanbul) itibaren 30 gün.
- Para birimi ve uyruk dilin ayarından gelir.
- Sayfada açıkça yazar: "24 Eki giriş · 1 gece · 2 yetişkin · vergiler dahil" ve "Fiyatlar … itibarıyla".

**Aramayla aynı hesap.**
- Tarayıcı (scanner), canlı aramayla aynı bağlayıcı çağrısını ve aynı fiyatlama fonksiyonunu (`priceHotelOffer`) kullanır.
- Ayarlar da aynıdır: aynı ayar okuyucusu, aynı `maxRatesPerHotel`, aynı sağlayıcı zaman aşımı sabiti, aynı rota ve onaylı politikanın API marjı.
- Bir otelin bir tarihteki fiyatı, o anda aramada görünen en düşük fiyattır. Bu, entegrasyon ve e2e testlerinde karşılaştırılır.

**Parmak izi.**
- Fiyatın bağlı olduğu her şeyin özeti gün satırına yazılır: ortam, politika sürümü, rota yeteneği, marj, oran sayısı, fiyat eşleşmesi (rate parity), zaman aşımı, para birimi.
- Sayfa yalnız güncel parmak iziyle hesaplanmış fiyatı gösterir.
- Yeni politika onaylanınca eski fiyatlar hemen gizlenir ve günler yeniden taranır.

**Belirsiz yanıt.**
- Bir gün yalnız **tam** yanıtla değişir: o günün bütün çağrıları başarılı olmalıdır.
- Zaman aşımı, 5xx, bozuk yanıt veya ret o günün önceki fiyatlarını korur. Gün, artan aralıklarla yeniden denenir.
- "Fiyat yok" ile "yanıt yok" hiçbir zaman karıştırılmaz.

**Tazelik.**
- Fiyat, ayardaki süreden eskiyse gösterilmez.
- Geçmiş tarihli veya kapalı para birimli fiyat da gösterilmez.
- Gösterilmeyen fiyatın yerinde "Tarih seçin" bağlantısı olur.

**Otel sayfasındaki fiyat.**
- Otel sayfası, kendi arama formunun arayacağı fiyatı gösterir: bağlantının pansiyon filtresi ve tarihi.
  - Filtresiz bağlantıda yalnız filtresiz listelerin fiyatı gösterilir; yalnız "her şey dahil" listesindeki bir otelde fiyat gösterilmez.
  - Bağlantıdaki tarihin fiyatı varsa o tarih gösterilir. Fiyatın pansiyon tipi de yazılır.
- Bir otelin sayfa adresi ilk yayımlandığı haliyle kalır; sağlayıcı oteli yeniden adlandırsa da adres değişmez.

**Otelde ödenecek tutar.**
- Sağlayıcı otelde ödenecek bir tutar bildirirse "vergiler dahil" yazılmaz; tutar gösterilir.
- Tutar başka para birimindeyse "otelde ayrıca yerel vergi ödenebilir" yazılır.

**Tahsilat.**
- Liste fiyatı hiçbir zaman tahsilata girmez. Rezervasyon her zaman canlı arama → prebook → müşterinin kabulü (K15) yolundan geçer.
- "Fiyatları gör" otel sayfasını o tarihle açar; arama formu oteli, tarihi, uyruğu, para birimini ve pansiyon filtresini taşır.

**Maliyet ve hız.**
- Bir kapsamın günü için yer başına bir çağrı yapılır, otel kodları için de her 200 kodda bir çağrı.
- Günler varsayılan olarak 24 saatte bir yenilenir.
- Tüm worker süreçleri tek bir hız satırını paylaşır (varsayılan 1 istek/sn).
- Ayarlar teknik ortam değişkenleridir, işletme fiyat girdisi değildir:
  - `HOTEL_LIST_REFRESH_HOURS`
  - `HOTEL_LIST_CALLS_PER_SECOND`
  - `HOTEL_LIST_CANDIDATES`
  - `HOTEL_CONTENT_REFRESH_DAYS`

**Worker.**
- Tarama, giden olay kuyruğundan (outbox) ayrı ikinci bir döngüdür; sipariş işleme yuvalarını kullanmaz.
- Günler kiralanarak (lease) tek tek işlenir ve iki süreç aynı günü fiyatlayamaz. Kira her çağrıdan önce uzatılır; worker kimliği süreç başına benzersizdir.
- Başarısız bir gün artan aralıklarla yeniden denenir. Politika değişikliği yalnız başarıyla fiyatlanmış ve yeniden denemede olmayan günleri hemen sıraya alır; böylece hatalı günler çağrı fırtınası yaratmaz.
- Boşta kalınca bir otelin içeriği (`/data/hotel`) yavaşça çekilir.

### 4. Sayfalar

**Liste sayfası.**
- Kırıntı (breadcrumb), H1, editörün giriş metni.
- Otomatik özet: otel sayısı ve fiyat aralığı.
- Otel kartları: görsel, ad, yıldız, şehir, kaynağı belirtilmiş puan, olanaklar, fiyat ve koşulları, "Fiyatları gör".
- Fiyat zamanı, editör gövdesi, SSS, son güncelleme.
- JSON-LD: en üstte `ItemList`. Her öğe aynı alan adında ayrı bir otel sayfasına giden bir `Hotel`'dir.
  - Zorunlu alanlar: `name`, `image`, `url`.
  - Diğer alanlar: `address`, `starRating`, `amenityFeature`, 12 karakterden kısa `priceRange`.
  - Görseli olmayan otel işaretlenmez. Üçten az otel olursa `ItemList` yazılmaz.
  - Ayrıca `BreadcrumbList` yazılır.

**Otel sayfası.**
- Ad, yıldız, adres, görseller, açıklama, olanaklar, giriş/çıkış, önemli bilgiler, yakındaki yerler, listeler, otel kodu.
- Fiyat kutusu ve otele kurulu arama formu.
- JSON-LD: `Hotel` (`geo`, saatler, açıklama).
- `aggregateRating` hiçbir sayfada yazılmaz.

**İndeksleme.**
- Otel sayfası, yayımlanmış bir listede o dilde **gerçekten gösteriliyorsa** (yıldız filtresi ve en çok otel sayısı dahil) indekslenir; değilse `noindex` alır. `hreflang` ve sitemap yalnız bu dilleri içerir.
- Liste dizini ve liste sayfaları dil düşüşü (fallback) kullanmaz: yalnız Türkçe adresi olan liste İngilizce dizinde çıkmaz.
- `HOTEL_PAGES_NOINDEX=true` tüm otel sayfalarını dizin dışı tutar. İçerik hakkı yazılı teyit edilmezse kullanılacak acil durum anahtarıdır.
- Sitemap şunları içerir: liste dizinleri, listeler ve listelerde görünen oteller.

**GEO.**
- Önemli bilgi düz metindedir: özet, fiyat koşulları, SSS. Sayfa sunucuda üretilir.

### 5. Reklam ve ölçüm

- Sayfalar arama reklamlarında nihai URL olarak kullanılabilir.
- Reklamdaki fiyat sayfadaki koşullu fiyatla aynı olmalıdır. Taze olmayan fiyat gösterilmez; reklama da yazılmamalıdır.
- Search Console doğrulama etiketi işletme girdisidir (hesap sahibi verir).

**Reklam sayfa feed'i (P17c).**
- `/yonetim/raporlar/reklam-sayfalari` (`content.edit` / `content.publish`) Google Ads sayfa feed'i CSV'sini indirir: `Page URL`, `Custom label`; etiketler `;` ile ayrılır.
- Satırlar: yayındaki her liste sayfası ve bu listelerin gösterdiği her otel sayfası, dil başına ayrı; tam adres `PUBLIC_BASE_URL` ile. Adres tanımsızsa dosya üretilmez.
- Etiketler: `liste`/`otel`, dil, `liste-{adres}` (otelin yer aldığı her liste), `pansiyon-{kod}`, `fiyatli` (sayfada şu an fiyat var), `noindex` (CMS'te noindex liste ya da `HOTEL_PAGES_NOINDEX` açıkken otel sayfaları: Dinamik Arama Ağı yalnız dizindeki sayfalarda çıkar).
- Satırlar sitedeki okuma modelinden (`HotelListPages.adsPages`) gelir; sayfada olmayan adres feed'e girmez. Hücreler RFC 4180'e göre tırnaklanır, formül işaretiyle başlayan hücre kaçırılır.
- Dosya personel oturumu ister; Google Ads'in zamanlanmış URL yüklemesi bu yüzden şimdilik yok (elle yükleme).

**Fiyat doğruluğu ölçümü (P17c).**
- Ziyaretçinin canlı otel araması liste referansıyla aynıysa (1 oda, 2 yetişkin, çocuksuz, 1 gece; etkin bir kapsamın para birimi, uyruğu ve pansiyonu), aramadaki her otelin en düşük fiyatı aynı otel ve tarihin saklı liste fiyatıyla karşılaştırılır ve `core.hotel_list_price_checks`'e yazılır. **Sağlayıcıya ek çağrı yoktur.**
- Yalnız bugünkü fiyatlama parmak iziyle hesaplanmış liste fiyatları karşılaştırılır (diğerleri zaten gösterilmez). Fiyat sayfada gösterilecek kadar tazeyse `shown` işaretlenir.
- Sonuç: `SAME`, `LIVE_HIGHER` (liste canlıdan ucuz göründü: reklam ve güven riski), `LIVE_LOWER`, `LIVE_MISSING` (yalnız o otel için yapılan aramada müsaitlik yok; bölge aramasında sonuç sınırı yüzünden eksik otel sayılmaz).
- Karşılaştırma aramayı asla bozmaz: hata yalnız sunucu günlüğüne yazılır. Arama başına en çok 100 satır; kayıtlar 90 gün tutulur (tarayıcı saatte bir siler).
- `/yonetim/raporlar/liste-fiyatlari` (içerik, fiyat politikası veya finansal görüntüleme izni): 7/30/90 gün; para birimi başına gösterilen ve tüm fiyatlar için aynı/yüksek/düşük/müsait değil sayıları ve ortalama fark; "dikkat gerektirenler": müsait olmayanlar ve en büyük yüzde fark önce, otel sayfası bağlantısıyla.

**Panelde otel adıyla bulma (P17c).**
- Liste düzenleme ekranında "Otel adıyla bul": ülke kodu (varsayılan TR) ve adın bir kısmı; sonuçta ad, yıldız, adres ve kod. "Ekle", "Başa sabitle", "Çıkar" kodu ilgili alana yazar; bir kod tek alanda durur.
- Arama `GET /data/hotels?hotelName&countryCode` ile yapılır (sandbox ülkesiz aramayı 4000 ile reddetti, R0 §11). Uç nokta `/api/v1/staff/hotel-names` yalnız içerik personeline açıktır (her istek sağlayıcı çağrısıdır), kişi başına dakikada 60 arama.

## Sonuçlar

- MOCK ortamında web süreci bir geliştirme uç noktasıyla taramayı çalıştırır. Bunu yalnız `content.publish` izni olan personel çalıştırabilir; testler bunu kullanır.
- İşletme, Nuitee içeriğinin kullanımını 10 Ekim 2026'da onayladı. Yazılı teyit, arama ücreti, hız sınırı ve `min-rates` marjı Nuitee sorusu 23'tedir.
