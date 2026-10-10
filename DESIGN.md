# TexHoliday tasarım dili — "Akdeniz kuponu"

Bu dosya sitenin (`apps/web/src/app/[locale]/globals.css`) ve yönetim panelinin (`apps/web/src/app/yonetim/admin.css`) görsel sözleşmesidir. Yeni ekran yaparken önce buraya bakın; burada olmayan bir renk, yazı tipi ya da süs eklemeyin.

## Fikir

Tatil, eline alınan bir kupondur: üzerinde ne aldığın, ne zaman, kaça ve hangi koşulla yazar. Site bu nesneyi taklit eder:
- Oda teklifleri **koparılabilir bilet** gibidir: solda oda, pansiyon ve iptal koşulu; delikli çizginin sağında fiyat ve "Seç".
- Rezervasyon özeti bir **kupondur**: koyu başlık şeridi, otel, tarihler, koşul, delikli çizgi, toplam.
- Rezervasyon numarası kesik çizgili bir **koçan** içinde durur.

Zemin Akdeniz akşamıdır: Toros sırtları, körfez, batan güneş. Fotoğraf ve başka markaların görselleri kullanılmaz; bütün çizimler koddadır (`components/ui/Art.tsx`).

## Renkler

| Rol | Değer | Nerede |
|---|---|---|
| Derin deniz | `#062a3a` … `#0b4f6c` (`--sea-900`…`--sea-700`) | Başlık, giriş görseli, alt bilgi, panel menüsü, ikincil düğme ve bağlantı |
| Tuz beyazı zemin | `#f3f6f7` (`--salt`) | Sayfa zemini (krem değil, serin) |
| Kâğıt | `#ffffff` | Kartlar |
| Kiremit | `#b5482a`, üzerine gelince `#963a21` | **Yalnız** ekranın tek ana eylemi (Ara, Seç, Ödemeye geç, Uygula). Panelde kullanılmaz |
| Güneş | `#f4bb4a` | Yalnız koyu zemin üzerinde küçük vurgular (odak halkası, "Yakında", seçili menü) ve çizimler |
| Mürekkep | `#10222c`, ikincil `#3d5260` | Metin |
| Durum | iyi `#1d6b3a`, uyarı `#8a4b00`, hata `#a4161a` | Etiket ve bildirimler, açık zeminleriyle |

Bütün metin/zemin çiftleri WCAG AA (4,5:1) geçer; koyu zeminde odak halkası güneş rengindedir.

## Yazı

- **Bricolage Grotesque** (değişken): başlıklar, fiyatlar, marka. Sıkı harf aralığı (−0,015 / −0,035em büyük başlıkta).
- **Inter** (değişken): okunan ve doldurulan her şey.
- İkisi de `@fontsource-variable` ile sunucudan gelir (dış istek yok, CSP `font-src 'self'`). Türkçe karakterler latin-ext alt kümesindedir.
- Fiyatlarda `tabular-nums`.

## İkonlar

`lucide-react`, çizgi kalınlığı 1,75, metin boyunda (`svg.lucide` kuralı). Her zaman bir metnin yanında, `aria-hidden`; tek başına anlam taşımaz. Emoji ikon yok.

## Biçimler

- Köşe: 8 / 14 / 20 px. Kart gölgesi hafif (`--shadow-1`), yüzen öğeler (arama kartı, öneri listesi, çerez bandı) `--shadow-2`.
- Delik ve çentik: `2px dashed` çizgi + zemin renginde 18 px yarım daireler (`.offer .price`, `.summary .total`, `.promise li`).
- Arama kartı **bölmeli** bir çubuktur (`.search-main` + `.seg`): etiket küçük ve üstte, alan çerçevesiz; odakta bölme 3 px odak halkası alır.
- Dokunma hedefi en az 44 px; birincil düğme 48–52 px.

## Hareket

Tek bir yazılmış an: ana sayfada güneş ufka oturur, ardından denizdeki ışık belirir (`.coast-sun`, `.coast-glitter`). Başka giriş animasyonu yok; geçişler 150 ms renk/gölge. `prefers-reduced-motion` hepsini kapatır.

## Ekran kipleri

- **Ana sayfa (ikna):** kıyı sahnesi, üzerine oturan arama kartı, "nasıl satıyoruz" kupon şeridi (yalnız akışın gerçekten yaptığı şeyler: toplam fiyat, her teklifte iptal koşulu, Nuitee'nin güvenli ödemesi), CMS'te varsa otel listeleri ve rehber yazıları, uçak satışı açıksa uçak bandı.
- **Sonuçlar, rezervasyon, panel (iş görme):** okunabilirlik önce. Sonuçlarda filtreler GET formudur (JavaScript'siz çalışır, bağlantı paylaşılır) ve yalnız saklı sonuçları daraltır; sağlayıcıya yeniden gidilmez, fiyat değişmez.
- **Rehber, SSS (okuma):** 72 karakter satır, sade.

## Çizimler (`components/ui/Art.tsx`)

- `BrandMark`: kiremit bilet, ufka batan güneş, iki dalga.
- `CoastScene`: Likya kıyısında akşam; alttan sabitlenir, dar ekranda da güneş ve ufuk görünür.
- `HotelArt`: fotoğrafı olmayan otel için kartpostal. Otel kodundan türetilir (aynı otel hep aynı resim); dört palet, sırtlar, güneş, otel bloğu, palmiye. Sağlayıcı fotoğrafı varsa her zaman fotoğraf gösterilir.

## Yapılmayacaklar

Kenarına renkli şerit çekilmiş bilgi kutuları (sitede), gradyan metin, cam efekti, aynı boyda ikon-kart ızgarası, başlık üstü küçük etiketler (eyebrow), krem zemin, ikinci bir vurgu rengi, kopyalanmış OTA görselleri.
