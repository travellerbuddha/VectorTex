# TexHoliday tasarım dili — "Kıyı"

Bu dosya misafir sitesinin (`apps/web/src/app/[locale]/globals.css`) görsel sözleşmesidir. Yönetim paneli ayrı dosyadadır (`apps/web/src/app/yonetim/admin.css`) ve bu sözleşmenin dışındadır. Yeni ekran yaparken önce buraya bakın; burada olmayan bir renk, yazı tipi ya da süs eklemeyin.

## Fikir

İki ilke birlikte çalışır:
- **Ara ve karşılaştır:** Arama ilk ekranda kullanıma hazırdır. Otel kartı her zaman aynı sırayla okunur: fotoğraf, ad, yıldız ve konum, puan, koşullar, fiyat ve eylem. Oda teklifleri kartlar arasında hizalanan satırlardır.
- **Sakin ürün sayfası:** Beyaz zemin, güçlü başlık tipografisi, kontrollü boşluk ve az vurgu. Görsel öne çıkar, süs geri çekilir.

Marka şunlardan oluşur: resmi `texholiday` logosu, derin deniz paleti, sitenin kendi kıyı ve kartpostal çizimleri, rezervasyon özetindeki delikli kupon. Fotoğraf ve başka markaların görselleri eklenmez. Görseller sağlayıcıdan, CMS'ten ya da `components/ui/Art.tsx` içinden gelir.

## Renkler

| Rol | Değer | Nerede |
|---|---|---|
| Kâğıt | `#ffffff` (`--paper`) | Sayfa zemini, kartlar, paneller |
| Sis | `#f4f6f7` (`--mist`), üzerine gelince `#e9eef0` | İş sayfalarının zemini (sonuçlar, rezervasyon, ödeme, sipariş, hesap); seçili sekme, alan hover |
| Derin deniz | `#041f2b` … `#0b4f6c` (`--sea-950`…`--sea-700`) | Alt bilgi, uçak karosu, kupon şeridi, puan rozeti; açık zeminde bağlantı ve ikincil düğme |
| Kiremit | `#b5482a`, üzerine gelince `#963a21` | **Yalnız** ekranın tek ana eylemi (Ara, Seç, Fiyatları gör, Ödemeye geç, Uygula) |
| Güneş | `#f4bb4a` | Yalnız koyu zemin üzerinde: uçak karosunun düğmesi, odak halkası, çizimler |
| Logo mercanı | `#ff5757` | **Yalnız** resmi logonun içinde (`public/brand/texholiday-wordmark.svg`) |
| Mürekkep | `#0f1f28`, ikincil `#3d5260`, üçüncül `#5a6d78` | Metin; üçüncül yalnız meta ve ikinci ton başlıklar |
| Çizgi | `#e3e9ec`, güçlü `#d2dce1`, form kenarı `#7a8f9a` | Ayraçlar, kart kenarları, alan kenarları (3:1) |
| Durum | iyi `#1d6b3a`, uyarı `#8a4b00`, hata `#a4161a` | Etiket ve bildirimler, açık zeminleriyle |

Bütün metin/zemin çiftleri WCAG AA geçer. Koyu zeminde odak halkası güneş rengindedir.

## Yazı

- **Bricolage Grotesque** (değişken): yalnız sayfa ve bölüm başlıkları (h1, h2), alt bilgi vaadi, sipariş durumu. Ölçek:
  - Ana sayfa başlığı `clamp(3rem, …, 6.25rem)` / 720 / −0,05em.
  - Bölüm başlıkları `clamp(2rem, …, 3.5rem)` / 700 / −0,045em.
  - Sayfa başlığı `clamp(2rem, …, 2.875rem)` / 700 / −0,035em.
  - İş sayfalarının h1'i daha küçüktür (`≤ 2.375rem`).
- **Inter** (değişken): kart başlıkları, fiyatlar, formlar ve okunan her şey. Kart başlığı 650–680 ağırlık, −0,02em.
- Fiyatlarda `tabular-nums`, 700–720 ağırlık.
- İki yazı tipi de `@fontsource-variable` ile sunucudan gelir (dış istek yok, CSP `font-src 'self'`).

## İkonlar

`lucide-react`, çizgi kalınlığı 1,75, metin boyunda. Her zaman bir metnin yanında ve `aria-hidden`; tek başına anlam taşımaz. Emoji ikon kullanılmaz.

## Biçimler

- **Köşeler:** 6 px (özellik etiketi), 10–12 px (alan), 16 px (arama çubuğu, panel), 22 px (kart, görsel), 30 px (sahne ve karolar). Eylem düğmeleri hap biçimlidir (`999px`).
- **Gölgeler:** Kartlar gölgesizdir, yalnız ince çizgi taşır. `--shadow-2` yüzen öğelerde ve kart hover'ında, `--shadow-3` ana sayfa arama kartında ve çerez bandında kullanılır.
- **Üst bilgi:** Yarı saydam beyaz ve bulanık zemin (yalnız burada). Solda logo, ortada ürün sekmeleri, ince bir ayraç ve CMS sayfaları, sağda Rezervasyonlarım ve TR · EUR.
  - Bulunulan bölüm hap zeminle işaretlenir.
  - Yapışkandır; ilk 8 px kaydırmada üst kenarın altına kayar ve alt çizgi belirir, altındaki içerik yer değiştirmez.
  - Telefonda ikinci satır (ürünler) yana kayar; sekmeler daralmaz (`flex: none`).
- **Arama:** bölmeli tek çubuk (`.search-bar`, `.seg`). Etiket küçük ve üstte, değer çerçevesizdir.
  - Odakta bölme 3 px iç odak halkası ve sis zemini alır.
  - Düzen formun genişliğine bağlıdır (container query): 860 px+ tek satır, 600 px+ iki satır, 300 px+ tarihler yan yana, altında yığın.
  - Ana sayfada çubuk sahnenin alt kenarına biner, kendi kenarlığını bırakır ve kart çerçevesini kullanır.
  - Giriş ve çıkış bölmeleri tek bir takvim panelini açar (`DateRangeField`): geniş formda iki ay, dar formda bir ay; konaklama uçlar deniz-700 daire, aradaki günler deniz-50 bant; bugün çerçeveli; ok tuşları gün/hafta, PageUp/PageDown ay, Escape kapatır. İlk seçim girişi, ikinci seçim çıkışı belirler ve panel kapanır.
  - Oda, yetişkin ve çocuk sayıları "Misafirler" panelinde −/+ sayaçlarıdır (`Stepper`, 44 px hedef, sınırda `aria-disabled`); çocuk yaşları seçim kutusudur. Para birimi üst bilgidedir, uyruk sorulmaz.
- **Uçuş araması:** aynı çubuk. Üstte sis zeminli segment kontrol (Gidiş-dönüş | Tek yön); gidiş-dönüşte aynı tarih aralığı paneli, tek yönde tek tarih; yolcular −/+ sayaçlarıyla panelde.
- **Karşılaştırma kartı** (`li.hotel`, sonuçlar):
  - Üst satırda solda fotoğraf (248 px), sağda ad, yıldız ve konum, puan rozeti ve "başlayan fiyat".
  - Altta tam genişlikte teklif satırları: solda oda adı ve etiketler, kesik çizginin sağında toplam, "Konaklama toplamı", gecelik ortalama ve **Seç**.
  - Telefonda fotoğraf üstte; Seç fiyatın sağında, 400 px altında uzun toplam kendi satırında.
  - Uzun adlar kırılır, puan gerekirse adın altına iner.
- **Liste kartı** (`.hotel-card`): aynı okuma sırası, liste fiyatı ve "Fiyatları gör" kendi sütununda.
- **Keşif kartı** (`Postcard`): görsel önce (22 px köşe, çerçevesiz), sonra başlık ve tek satır. Kartın tamamı bağlantıdır. Ana sayfada `.discover` (en yeni liste geniş), rehberler `.guide-rows` (solda görsel, sağda metin, ince çizgiyle ayrılmış satırlar).
- **Etiket aileleri** renkten başka biçim ve ikonla ayrılır, tek boyuttadır (26 px):
  - *Koşul* (iptal, ödeme, rezervasyon durumu): hap biçimi, durum zemini, durum ikonu (`.tag`, `.tag.ok`, `.tag.warn`).
  - *Özellik* (pansiyon, olanaklar): 6 px köşe, açık deniz zemini (`.tag-feature`, `.offer-board`, `.chips li`).
  - *Kampanya / liste*: 6 px köşe, koyu deniz üstünde güneş-300 yazı (`.tag-campaign`).
  - Yalnız veride olan bilgi etiketlenir. "Ücretsiz iptal" yalnız teklifin koşulundan gelir.
- **Kupon:** Rezervasyon özeti (`.summary`) koyu başlık şeridi, konaklama, delikli çizgi ve toplamdan oluşur. Hesaptaki rezervasyonlar ve uçuş teklifleri aynı delik ve çentiği taşır.
- **Formlar:** Alanlar 48 px yükseklikte ve 12 px köşelidir. Kart içindeki gruplar ikinci çerçeve almaz; başlık ve ince çizgiyle ayrılır.
- **SSS:** İnce çizgiyle ayrılan satırlar. Sağdaki artı açılınca çarpıya döner, cevap yükseklik geçişiyle açılır.
- **Dokunma hedefi** en az 44 px. Birincil düğme 48–52 px. Filtre kutuları 20 px görünür ama 44 px hedeftir.

## Ekran kipleri

- **Ana sayfa (ikna):**
  1. Kıyı sahnesi (yuvarlak köşeli karo), gökyüzünde büyük başlık ve vaat; arama çubuğu sahnenin alt kenarında.
  2. "Nasıl satıyoruz": ortalı bir cümle ve ince çizgilerle ayrılan üç gerçek (yalnız akışın yaptığı şeyler).
  3. CMS listeleri (`.discover`).
  4. Uçak satışı açıksa koyu karo: solda teklif, sağda `public/art/coast-scene.png`.
  5. Rehberler: solda yapışkan başlık sütunu, sağda satırlar.
- **Ürün girişi (uçak):** Aynı sahne ve aynı yükseklikte, daha küçük başlık. Sahne yüksekliği genişlikle birlikte artar (`min-height: calc(300px + 14.5vw)`), böylece güneş hiçbir ekranda yazının arkasına çıkmaz.
- **Sonuçlar, rezervasyon, ödeme, hesap (iş görme):** Sis zemin üstünde beyaz kartlar, okunabilirlik önce.
  - Sonuç sayısının yanında sıralama her zaman görünür (`SortForm`, seçince gönderilir; JavaScript yoksa düğmeyle).
  - Filtreler GET formudur: JavaScript'siz çalışır, bağlantıyla paylaşılır, geri/ileri ve yenilemede korunur; sıralama ve filtreler birbirini taşır.
  - Filtreler masaüstünde yapışkan sütunda, telefonda tam genişlik düğmenin açtığı panelde durur.
- **Otel sayfası:** Başlık satırında ad, yıldız ve konum, sağda puan. Altında tek çerçeveli mozaik galeri, ardından ince çizgilerle ayrılan bölümler (olanaklar onay işaretli liste). Sağda yapışkan fiyat ve arama kutusu, telefonda açıklamadan önce gelir.
- **Rehber, SSS, yasal (okuma):** 70–76 karakter satır, büyük başlık, sade.

## Hareket

İki hız vardır: keşif sayfalarında kaydırmayla ilerleyen, kimlik taşıyan bir akşam; arama, sonuç, rezervasyon ve ödemede neredeyse görünmez, hızlı geri bildirim. Metin hiçbir karede yarı saydam olmaz (yalnız `transform` ve renk); fiyat ve düğmeler animasyonu beklemez.

- **Ana sayfa girişi** (yükte): başlık kelimeleri kendi satır kutularından 90 ms arayla yükselir, alt yazı ve arama çubuğu yerine oturur, sahne 1,04'ten oturur, güneş ufka iner. Arama ilk kareden kullanılabilir.
- **Batan güneş** (imza, kaydırmaya bağlı, `animation-timeline`): ana sayfa ve uçuş girişinde sahne ekrandan çıkarken güneş denize batar (`.coast-sunset`), ışıltı söner, gökyüzü koyulaşır (`.hero-stage::after`), sahne 0,965'e geri çekilir. Geri kaydırınca tersine döner. Güneş her zaman yazının altında kalır.
- **Mürekkep dolumu**: "Nasıl satıyoruz" cümlesi ekranı geçerken kelime kelime mürekkep-3'ten mürekkebe (vurgu kısmı deniz-700'e) dolar; her ara renk AA geçer.
- **Çerçeveye oturma**: liste ve rehber görselleri kartları gelirken çerçevelerinin içinde 1,1'den 1'e yerleşir (zaman çizelgesi çerçevede, `--frame`).
- **Uçak karosu** girerken 0,92'den tam boyuna açılır; içindeki kıyı görseli kaydırmayla hafifçe kayar (`--tile`).
- **Bir kez görünme** (`reveal.ts`): başlıklar, kartlar ve rehber satırları ekranın altından yalnız `transform` ile yükselir; eşik 0, alt pay 96 px; ekranda ya da 96 px yakınında olan hiç hazırlanmaz; geri kaydırmada tekrar etmez. Alt bilgideki dev logo kendi kutusundan yükselir.
- **Sonuçlar**: ilk altı kart yükte 8 px'ten 40 ms arayla yerine oturur (yalnız transform).
- **Paneller** (takvim, misafir, dil) tetikleyicisinden 200 ms'de 6 px ve 0,98'den açılır, 140 ms'de kapanır. **Geri bildirim** 160 ms: düğme 0,98'e basılır, seçilen gün dolar, sayaç yerinde değişir.
- **Sayfa geçişleri** (`@view-transition`): üst bilgi yerinde kalır, içerik 260 ms'de çapraz geçer; liste kartındaki otel fotoğrafı otel sayfasındaki ilk galeri fotoğrafına dönüşür (`hotelTransition`).
- Kaydırmaya bağlı efektler `@supports (animation-timeline: view())` içindedir; desteklemeyen tarayıcı son hali statik gösterir. `prefers-reduced-motion` bütün hareketi ve sayfa geçişlerini kapatır; içerik ve paneller aynen çalışır.

## Çizimler (`components/ui/Art.tsx`)

- Resmi logo: `public/brand/texholiday-wordmark.svg`; misafir sitesinde üst ve alt bilgide kullanılır.
- `BrandMark` yönetim panelinde kalır.
- `CoastScene`: Likya kıyısında akşam. Ana sayfa ve uçak girişi sahnesinde canlı SVG, uçak karosunda 4000×1400 PNG çıktısı olarak kullanılır.
- `HotelArt`: fotoğrafı olmayan otel, liste ve rehber için kartpostal. Aynı tohumdan hep aynı resim çıkar. Sağlayıcı ya da CMS görseli varsa her zaman o gösterilir.

## Yapılmayacaklar

- Kenarına renkli şerit çekilmiş bilgi kutuları.
- Gradyan metin; üst bilgi dışında cam efekti.
- Kart içinde kart, aynı boyda ikon-kart ızgarası, her bölüme başlık üstü etiket (yalnız "Nasıl satıyoruz").
- Krem zemin, ikinci bir vurgu rengi.
- Kopyalanmış OTA görselleri.
- Veride olmayan indirim, popülerlik, kıtlık veya güven iddiası.
