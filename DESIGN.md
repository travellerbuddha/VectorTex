# TexHoliday tasarım dili: "Mercan"

Bu dosya misafir sitesinin görsel sözleşmesidir. Stiller `apps/web/src/app/[locale]/styles/` klasöründe, dokuz dosyada durur ve `layout.tsx` bunları şu sırayla yükler:

1. `foundation`: değişkenler, temel stiller, yazı, düğmeler, formlar, etiketler.
2. `chrome`: üst bilgi, alt bilgi, açılır paneller, çerez bandı.
3. `search`: arama kartı, takvim, sayaçlar.
4. `home`: ana sayfa ve ürün girişleri.
5. `results`: sonuçlar ve karşılaştırma kartı.
6. `hotels`: kartpostallar, liste ve otel sayfası.
7. `booking`: rezervasyon adımları, kupon, ödeme, sipariş, hesap.
8. `content`: rehber, SSS, CMS ve yasal sayfalar, 404.
9. `motion`: bütün hareket kuralları ve azaltılmış hareket.

Yönetim paneli ayrıdır (`apps/web/src/app/yonetim/admin.css`). Yeni ekran yaparken önce buraya bakın. Burada olmayan bir renk, yazı tipi ya da süs eklemeyin.

## Fikir

İki ilke birlikte çalışır:

- **Ara ve karşılaştır (Hotels.com'dan alınan ders):**
  - Arama ilk ekranda, ilk kareden kullanılabilir.
  - Otel kartı hep aynı sırayla okunur: fotoğraf, ad, yıldız ve konum, puan, koşullar, fiyat, eylem.
  - Oda teklifleri otelin sayfasında hizalı satırlardır.
  - Kararı kolaylaştıran etiketler yalnız verinin söylediğini söyler.
- **Sakin ürün sayfası (Apple'dan alınan ders):**
  - Nötr zemin, güçlü başlık, temiz hiza, kontrollü boşluk, tek vurgu rengi.
  - Görsel ve ana mesaj öne çıkar.
  - Hareket az, amaçlı ve kesintisizdir.

Marka şunlardan oluşur:

- Resmi `texholiday` logosu ve onun mercan rengi.
- Sitenin kendi kıyı ve kartpostal çizimleri.
- Rezervasyon özetindeki delikli kupon.

Başka markaların görselleri eklenmez. Görseller sağlayıcıdan, CMS'ten ya da `components/ui/Art.tsx` içinden gelir.

## Marka rengi: kaynak ve karar

- **Doğrulanmış tek marka varlığı resmi logodur** (`design-assets/logo/texholiday-logo-source.{svg,png}`, `public/brand/texholiday-wordmark.svg`). Logo tek renktir: **#ff5757**, küçük harfli geometrik yazı.
- Önceki tasarımların derin deniz (#0b4f6c) ve kiremit (#b5482a) renkleri ilk kez müşteri sitesinin ilk sürümünde (commit 485083b) kod varsayılanı olarak geçer; arkalarında bir marka dosyası yoktur. Bu tasarımda kullanılmazlar. Deniz tonları yalnız kıyı çiziminin içinde, denizi resmetmek için kalır.
- **Çözülemeyen belirsizlik:** Logo dışında bir marka rehberi (ikincil renkler, yazı tipi) projede yok. Rehber gelirse bu bölüm ona göre güncellenir.

## Renkler

| Rol | Değer | Nerede |
|---|---|---|
| Mercan (logo) | `#ff5757` (`--coral`) | Logo, kıyı çizimindeki güneş. Beyaz zeminde metin için kullanılmaz (3,1:1). |
| Mercan 600 | `#d63a3a` | **Eylemler:** Ara, Seç, Ödemeye geç, Uygula. Seçili takvim günü, filtre kutuları, geçerli adım, menüde bulunulan ürünün alt çizgisi. Beyaz yazıyla 4,6:1. |
| Mercan 700 | `#b42f2f` | Düğme hover, vurgulu metin ("iptal koşulu her teklifte"), bağlantı hover. Beyazda 6,2:1. |
| Mercan 50 / 100 / 800 | `#fff4f3` / `#ffe5e4` / `#8e2424` | Seçili sıralama, seçili filtre çipleri, konaklama bandı, kampanya/liste etiketi, rezervasyon numarası kutusu. 800, 100 üstünde 7,2:1. |
| Mürekkep | `#14161a`, ikincil `#4b5059`, üçüncül `#656b75` | Metin. Odak halkası ve tamamlanan adım da mürekkeptir. |
| Kâğıt / zemin | `#ffffff` / `#f5f5f7` (`--canvas`), `#ebecef` | Keşif sayfaları beyaz. İş sayfaları (sonuç, rezervasyon, ödeme, sipariş, hesap) gri zemin üstünde beyaz kart. |
| Çizgi | `#e4e6ea`, güçlü `#d2d5db`, form kenarı `#80868f` | Ayraçlar, kart kenarları, alan kenarları (3:1 ve üstü). |
| Durum | iyi `#1a6b3c`, uyarı `#8a4b00`, hata `#a4161a`, açık zeminleriyle | Etiket ve bildirimler. Hata her zaman ikon ve metinle gelir, renk tek başına anlam taşımaz. |

Bütün metin/zemin çiftleri WCAG AA'yı geçer.

## Yazı

- **Plus Jakarta Sans** (değişken, 200–800). Tek aile, sunucudan gelir (`@fontsource-variable`, CSP `font-src 'self'`). Geometrisi logonun yazısına yakındır; Türkçe karakterleri ve ₺ işareti vardır.
- Font geç gelirse metin kaymaz: `PJS Fallback` (yerel Arial/Helvetica), yazı tipinin genişlik ve satır ölçülerine üç ağırlık aralığında ayrı ayrı ayarlıdır (%103, %99,3, %100,5; Türkçe arayüz metniyle ölçüldü).
- Ölçek:
  - Ana sayfa başlığı `clamp(2.5rem, …, 4.5rem)` / 780 / −0,045em.
  - Bölüm başlıkları `clamp(1.625rem, …, 2.5rem)` / 740 / −0,036em.
  - Sayfa başlığı `clamp(1.875rem, …, 2.75rem)` / 760.
  - Kart başlığı 1,0625–1,3125rem / 700–750.
  - Gövde 16 px / 450.
- Fiyatlar 750–780 ağırlıkta. Hizalama gereken tablolarda `tabular-nums`.

## İkonlar

`lucide-react`, çizgi kalınlığı 1,75, metin boyunda, her zaman bir metnin yanında ve `aria-hidden`. Eylem ve seçim ikonları mercan 600, bilgi ikonları mürekkep 3. Emoji kullanılmaz.

## Biçimler

**Köşeler:** etiket 8 px, alan 12 px, kart ve panel 16 px, görsel ve büyük karo 24 px. Her eylem hap biçimindedir (999 px).

**Gölgeler** mürekkep tonundadır:
- Kartlar gölgesiz, ince çizgili. Hover'da `--shadow-2`.
- Arama kartı, rezervasyon kutusu ve açılır paneller `--shadow-3`.

**Üst bilgi:**
- 1100 px ve üstü: beyaz, yarı saydam ve yapışkan tek satır (64 px): logo, ürünler ve editör sayfaları, hesap ve TR · EUR.
- 1100 px altı: üst bilgi sayfayla birlikte kayar (satırları telefon ekranının beşte birini kaplardı). Ürünler eşit sütunlardır (telefonda ikon üstte, tablette yanda); satışta olmayanların altında tek bir "Yakında" çizgisi; editör sayfaları (Oteller, Seyahat rehberi, SSS) ayrı satırda. **Hiçbir öğe yana kaydırılarak bulunmaz**; 320 px'te de hepsi görünür.
- Kaydırınca yalnız alt çizgi belirir; hiçbir şeyin boyu ya da yeri değişmez. Durumu kaydırma dinleyicisi değil, sayfanın en üstündeki 8 px'lik gözcü işaretler (`IntersectionObserver`).
- Bulunulan ürün mercan alt çizgiyle işaretlenir. "Yakında" ürünler tek bir rozetle (dar ekranda tek bir başlıkla) gri durur; ekran okuyucu her birinde "Yakında" duyar.

**Arama:**
- Bölmeli tek kart (`.search-bar`, `.seg`). Etiket küçük ve üstte, değer çerçevesiz. Etiket ikonları mercan.
- Düzen formun kendi genişliğine bağlıdır (container query):
  - 860 px ve üstü: tek satır.
  - 600 px ve üstü: iki satır.
  - 300 px ve üstü: tarihler yan yana.
- Açık bölme altta mercan çizgi taşır; odakta 2 px mürekkep halka.
- Takvim:
  - Seçili günler mercan 600 daire, aradaki günler mercan 50 bant.
  - Uçuşta ipucu "Gidiş tarihi / Dönüş tarihi" der ve gece sayısı göstermez.
- Misafirler panelinde −/+ sayaçları vardır (44 px hedef, sınırda `aria-disabled`).

**Otel kartı** (`HotelCard`): ana sayfa rafında, liste sayfalarında ve arama sonuçlarında **aynı kart**.
- Okuma sırası: fotoğraf, ad, yıldız ve yer, puan ("9,1 Olağanüstü · 200 değerlendirme"), en çok üç etiket, fiyat bloğu ("En düşük fiyat" + tutar + koşul satırı) ve eylem.
- Etiketler yalnız veriden: listede olanaklar; sonuçta oda seçeneği sayısı ve, bir oda bugün hâlâ ücretsiz iptal edilebiliyorsa, "Ücretsiz iptalli oda var" (filtrenin kendi testi).
- Kartın tamamı tek bağlantıdır (adın bağlantısı kartı kaplar); eylem düğme gibi görünür ve aynı yere gider: listede "Fiyatları gör" otel sayfasına, sonuçta "Odaları gör" otelin bu aramadaki sayfasına.
- Düzen ekrana değil kartın aldığı genişliğe bağlıdır (container query): dar (raf, telefon) üst üste; 600 px'ten fotoğraf solda; 860 px'ten fiyat sağda kendi sütununda.
- Fiyatın zamanı listenin/rafın altında yazar. Puanın sağlayıcı verisi olduğu liste altında söylenir.

**Oda satırları** (otelin arama içindeki sayfası): her teklif bir satır; solda oda adı, pansiyon ve iptal etiketleri, ince çizginin sağında toplam, "Konaklama toplamı", gecelik ortalama ve **Seç**. Telefonda oda üstte, Seç fiyatın sağında.

**Kartpostal** (`Postcard`, listeler ve rehberler): görsel önce, sonra başlık ve tek satır. Ana sayfadaki liste mozaiğinde en yeni liste büyük, diğerleri yanında satır; telefonda hepsi satır.

**Etiketler:** tek boy (26 px), tek yazı (13 px / 650), tek köşe (8 px). Aileler dolgu, ikon ve sözle ayrılır:
- *Koşul* (iptal, ödeme, rezervasyon durumu): durum renginde açık zemin ve durum ikonu (`.tag`, `.tag.ok`, `.tag.warn`).
- *Özellik* (pansiyon, olanaklar, oda seçeneği sayısı): beyaz zemin, ince çizgi, özellik ikonu (`.tag-feature`).
- *Kampanya / liste üyeliği*: mercan 50 zemin, liste ikonu (`.tag-campaign`). Yalnız gerçek liste üyeliği gösterilir.
- Yalnız veride olan etiketlenir. "Ücretsiz iptal" yalnız teklifin koşulundan gelir. İndirim, son oda, en iyi fiyat ya da popülerlik iddiası yazılmaz.

**Kupon:** rezervasyon özeti (`.summary`) sırasıyla şunları taşır: başlık satırı, otel, tarihler, oda, koşul, delikli çizgi ve gri zeminde toplam. Hesaptaki rezervasyonlar ve uçuş teklifleri aynı delik ve çentiği taşır.

**Formlar:** alanlar 48 px yükseklikte ve 12 px köşeli; etiket üstte, hata altta. Kart içindeki gruplar ikinci çerçeve almaz.

**Dokunma hedefi** en az 44 px. Birincil düğme 48–52 px. Filtre kutuları 20 px görünür ama 44 px hedeftir.

## Ekran kipleri

### Ana sayfa (keşif ve ikna)

1. **Hero:**
   - Geniş ekranda solda başlık, alt yazı ve dikey arama kartı; sağda 6:5 kıyı sahnesi. Sol sütun sahneye göre dikeyde ortalanır.
   - Telefon ve tablette sırasıyla başlık, arama ve sahne (16:9, 720 px'ten itibaren 21:9).
2. **Otel rafı:**
   - En yeni yayındaki listenin otelleri, liste fiyatları ve koşullarıyla yatay kayan raf. Fiyatlar liste sayfasıyla aynı çekirdek kopyadan gelir.
   - Oklar yalnız fare/izleme dörtgeninde, satır taşarken görünür. Telefonda raf kaydırılır.
3. **Liste mozaiği.**
4. **"Nasıl satıyoruz":** gri karo; solda vaat cümlesi, sağda üç gerçek.
5. **Uçak:** satış açıksa mercan 50 karo.
6. **Rehber kartları.**
7. **SSS:** CMS'ten ilk beş soru ve "Tüm sorular" bağlantısı.

### Ürün girişi (uçak)

Aynı hero; başlık daha küçük.

### Sonuçlar (karşılaştırma)

- Arama özeti çubuğu; "Değiştir" formu yerinde açar.
- Masaüstünde solda yapışkan filtre sütunu. Telefonda tam genişlik düğmenin açtığı panel.
- Başlık satırında sonuç sayısı ve **bağlantı olarak sıralama** (Önerilen, En düşük fiyat, En yüksek puan; seçili olan mercan 100). Ok tuşlarıyla sayfa yenilenmez, bağlantı paylaşılır, JavaScript'siz çalışır.
- Seçili filtreler kaldırılabilir mercan çiplerdir; her çip yalnız kendini kaldırır.
- Filtreler GET formudur. Sıralama, filtreler ve arama parametreleri birbirini taşır (`filtersQuery`).
- Yüklenirken aynı çerçevenin gri iskeleti görünür (`loading.tsx`); sahte otel ya da fiyat yoktur.
- Kart **otelin bu aramadaki sayfasını** açar (`/search/hotels/{oturum}/{otel}`): doğrudan rezervasyona gitmez. Filtreler sayfaya taşınır; kartın fiyatı sayfadaki en düşük fiyatla aynıdır.

### Otelin arama içindeki sayfası

- "Sonuçlara dön", aynı arama özeti çubuğu ("Değiştir" bu oteli yeniden arar ve aynı sayfaya döner).
- Başlık (ad, yıldız, adres, puan) ve altında bu aramanın en düşük fiyatı; mozaik galeri; **Oda seçenekleri** (aramadaki tüm teklifler, sonuçla aynı fiyatlar, her birinde Seç); ardından otelin açıklaması, olanaklar, giriş-çıkış, önemli bilgiler, yakındaki yerler.
- Tek otel araması (otel sayfasından "Ara") sonuç listesini atlayıp doğrudan buraya gelir.
- Arama dizine girmez (`noindex`).

### Otel sayfası

- Başlık satırında ad, yıldız ve konum; sağda puan.
- Tek çerçeveli mozaik galeri (1, 2, 3 ya da 5 fotoğraf, boşluksuz).
- Sağda yapışkan rezervasyon kutusu; telefonda açıklamadan önce gelir.
- Olanaklar mercan onay işaretli sütunlardır. Otelin yer aldığı listeler kampanya etiketidir.

### Rezervasyon, ödeme, sipariş, hesap (iş görme)

- Adımlar: tamamlananlar mürekkep onay, geçerli adım mercan.
- Solda form ya da durum, sağda yapışkan kupon.

### Rehber, SSS, yasal (okuma)

70–76 karakter satır, büyük başlık, sade düzen.

## Hareket

Kurallar (`styles/motion.css`):

- Yalnız `transform` ve `opacity` hareket eder; metin hiçbir karede yarı saydam olmaz.
- Arama, fiyat ve düğmeler hiçbir animasyonu beklemez.
- **Hiçbir şey bütün olarak ölçeklenmez:** hero'da büyüme-küçülme yok.
- **Görsellerin çerçevesi ve oranı sabittir:** hiçbir animasyon bir görselin boyunu ya da SVG'nin iç parçalarını değiştirmez.
- **Kaydırmaya bağlı efekt yoktur:** sayfa kaydırırken uzayıp kısalmaz, kaydırma ele geçirilmez.

Hareketler:

- **Hero girişi:** başlık kelimeleri kendi kırpılmış satır kutularından 70 ms arayla yükselir (560 ms). Yalnız transform kullanıldığı için sayfa hidrasyon sırasında meşgulken de akıcıdır. Sahne ve arama ilk kareden yerindedir.
- **Bir kez görünme** (`reveal.ts`): bölüm başlıkları ve kart grupları ekranın altından yalnız transform ile yükselir. Ekranda ya da 96 px yakınında olan hiç hazırlanmaz; geri kaydırmada tekrar etmez.
- **Sonuçlar:** ilk altı kart yükte 8 px'ten 35 ms arayla oturur.
- **Paneller** (takvim, misafir, dil, öneriler) tetikleyicilerinden 200 ms'de 6 px ve 0,98'den açılır, 140 ms'de kapanır. Açılış `@starting-style`, kapanış `display` geçişiyle yapılır; desteklemeyen tarayıcıda anında açılıp kapanır.
- **Açılır bölümler** (filtre, arama özeti, SSS) `::details-content` ile doğal yüksekliğine açılır.
- **Geri bildirim:** düğme 0,97'ye basılır; seçilen gün ve sayaç yerinde değişir; kart hover'da gölge alır ama yer değiştirmez.
- **Sayfa geçişleri** (`@view-transition`): üst bilgi yerinde kalır, içerik 220 ms'de çapraz geçer. Raf, liste ve sonuç kartındaki otel fotoğrafı açılan otel sayfasının ilk fotoğrafına dönüşür. İki görüntü de hareket eden çerçeveye kırpılır (`view-transition-class: hotel-photo`, `object-fit: cover`); geçişte görsel esnemez ya da köşeden taşmaz.
- **Yükleniyor:** iskelet yavaşça nefes alır, döner simge yalnız sipariş durumunda kullanılır.
- **Yükte geçiş yok:** renk ve boyut geçişleri sayfa stilleriyle bir kez çizildikten sonra açılır (`SiteMotion`, `data-motion`). Geç gelen bir stil yerine anında oturur, tarayıcının varsayılanından renk süpürmesiyle gelmez.
- `prefers-reduced-motion: reduce` bütün animasyon, geçiş ve sayfa geçişlerini kapatır. İçerik ve paneller aynen çalışır.

### Eski hero hatalarının nedenleri (Ekim 2026 ölçümü) ve çözümü

1. **Bütün sahne ölçekleniyordu.** Giriş animasyonu sahneyi 1,4 sn'de %104'ten %100'e küçültüyordu; güneş 46 birim yukarıdan iniyordu.
   *Çözüm:* sahne statik.
2. **Güneş takılıp sıçrıyordu.** Güneş ve parıltı SVG'nin içindeki öğelerdi; animasyonları ana iş parçacığında çalışıp hidrasyon sırasında 93–357 ms donuyordu. Bu sırada sahne compositor'da ölçeklenmeyi sürdürdüğü için güneş sahneden kopup sıçrıyordu.
   *Çözüm:* SVG'nin içinde hiçbir şey canlanmıyor.
3. **Kutu ölçüsü değiştikçe çizim yeniden ölçekleniyordu.** Sahnenin yüksekliği başlık yüksekliği, `vh` ve `vw` hesaplarından çıkıyordu. `slice` ile dolduğu için font geç yüklenince, pencere yüksekliği ya da yönü değişince çizim yeniden ölçekleniyor ve kırpılıyordu.
   *Çözüm:* sabit `aspect-ratio`; çizimin ölçeği yalnız sütun genişliğine bağlı. Font yedeği ölçülere göre ayarlı.
4. **Kaydırırken sahne küçülüp büyüyordu.** Beş kaydırma animasyonu sahneyi 0,965'e küçültüyordu.
   *Çözüm:* kaydırmaya bağlı efekt yok.

## Çizimler (`components/ui/Art.tsx`)

- **Resmi logo:** `public/brand/texholiday-wordmark.svg`, misafir sitesinin üst ve alt bilgisinde.
- **`BrandMark`:** yalnız yönetim panelinde.
- **`CoastScene`:** Likya kıyısında akşam; 6:5 çerçeve için çizilmiş, alta sabitli. Güneş logonun mercanıdır, içinde animasyonlu parça yoktur. Ana sayfa ve uçak girişi hero'sunda kullanılır.
- **`HotelArt`:** fotoğrafı olmayan otel, liste ve rehber için kartpostal. Aynı tohumdan hep aynı resim çıkar. Sağlayıcı ya da CMS görseli varsa her zaman o gösterilir.

## Yapılmayacaklar

- Hero'yu ya da bir görseli bütün olarak büyütüp küçülten giriş animasyonu. Kaydırmaya bağlı ölçek, paralaks ya da renk değişimi.
- Sürekli salınan şekiller; yükleme iskeleti ve sipariş durumundaki döner simge dışında sonsuz animasyon.
- Kenarına renkli şerit çekilmiş bilgi kutuları, gradyan metin, üst bilgi dışında cam efekti.
- Kart içinde kart, aynı boyda ikon-kart ızgarası, her bölüme başlık üstü etiket ("Nasıl satıyoruz" tek istisna).
- İkinci bir vurgu rengi. Mercan dışında eylem rengi. Krem zemin.
- Kopyalanmış OTA görselleri. Veride olmayan indirim, popülerlik, kıtlık veya güven iddiası.
