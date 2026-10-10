# ADR-0012 — Müşteri uçak satış akışı: First Line destek, belge politikası, panelden uçak marjı

- Durum: Kabul edildi (2026-10-10).
- İlgili: ADR-0006 (API marjı), ADR-0008 (önce Nuitee tahsilatlı akış), ADR-0011 (uçak bağlayıcısı), şartname T04/T07/T08/T19, G06, R0 §10.3–10.4, Nuitee soruları 11–21.

## Bağlam

ADR-0011 uçak bağlayıcısını belgelenmiş API'ye göre kurdu ve müşteri akışını üç işletme kararına bağladı. İşletme 10 Ekim 2026'da şunları seçti:

- **Destek modeli:** First Line (Nuitee).
- **Yolcu belgesi:** her uçuşta alınsın.
- **Uçak marjı:** panelden yüzde (fiyat politikasında `FLIGHT` kuralı, dört göz onayı).

Saklama süresi seçilmedi. Seçeneğin açıklaması, süreyi işletmenin belirlemesi gerektiğini söylüyordu.

## Karar

### 1. Akış

Arama → teklif anahtarı → Nuitee'nin fiyatı yeniden doğrulaması (`/flights/verify`) → sunucuda değişmez teklif sürümü → yolcu ve iletişim formu → ödeme bileşeniyle prebook → müşteri dönünce book → bilet → onay.

- Doğrulamada fiyat değiştiyse yeni teklif sürümü yeni fiyatla oluşur. Müşteri kabul etmeden önce eski fiyat da gösterilir (K15).
- Prebook fiyatı kabul edilen tutardan farklıysa ödeme oturumu açılmaz. Sipariş `PRICE_CHANGED` olur (T04).

### 2. Book yalnız müşteri ödeme bileşeninden döndüğünde

Sandbox, ödemesi yapılmamış bir uçak rezervasyonunu kabul edip biletledi (R0 §10.3, soru 11). Bu yüzden:

- Uçakta zamanlanmış adımlar ve personelin "durumu kontrol et" komutu **book göndermez**. Book'u yalnız müşterinin dönüşü tetikler (`ProviderManagedBookingPort.bookTrigger = CUSTOMER_RETURN`). Otelde zamanlanmış adımlar book gönderebilir: Nuitee otelde ödenmemiş işlemi bilinen bir kodla reddediyor.
- Uçakta zamanlanmış tek adım, ödeme süresi dolunca checkout'u kapatmaktır. Ödeyip geri dönmeyen müşteride kartta provizyon kalmış olabilir. Bu yüzden kapanışta provizyon görevi açılır ve müşteriye bilgi e-postası gider (`mayHoldPayment: true`).
- Dönüşteki book sağlayıcı tarafından reddedilirse (production kodu bilinmiyor) sipariş biter. Provizyon görevi açılır ve sipariş otomatik yeniden denenmez.

### 3. Kayıp yanıt prebook üzerinden çözülür

Uçakta müşteri referansıyla sorgu yoktur. Book ise prebook başına idempotenttir (ADR-0011).

- Belirsiz bir book, aynı prebook ve aynı işlemle tekrar sorulur. Rezervasyon varsa döner. Ret gelirse, prebook'ta rezervasyon yok demektir.
- Gönderilmiş her referans için ayrı sorgu yapılmaz (`lookupScope = PER_PREBOOK`).
- Rezervasyon kimliği öğrenildikten sonra rezervasyon kimlikle okunur (`GET /flights/bookings/{id}`).

### 4. PNR bilet değildir (T08)

- Havayolu PNR'ı gelince Nuitee ödemeyi almıştır: ödeme `CAPTURED`. Ancak sipariş `PROCESSING` kalır ve müşteri "biletiniz düzenleniyor" (`ISSUING`) görür.
- Bilet `ticketData.ticketedAt` ile gelince rezervasyon `ISSUED` olur. Sipariş ancak o zaman `CONFIRMED` olur ve onay e-postası gider. E-postada PNR, varsa bilet numaraları ve First Line notu yer alır.
- Bilet gelmezse rezervasyon geri çekilmeli aralıklarla okunmaya devam eder. Otomatik deneme bütçesi dolunca `TICKETING_DELAYED` görevi açılır.
- Havayolu bilet çıkmadan iptal ederse sipariş iptal olur. İadeyi bir kişi doğrular (`REFUND_UNKNOWN`).

### 5. Personel iptali

- Bileti bekleyen ödenmiş uçuş da iptal edilebilir.
- Beklenen ücret Nuitee iptal teklifinden gelir (`PROVIDER_QUOTE`). Uçakta tarihli ceza adımı yoktur.
- Teklif alınamazsa ödenen tutarın tamamı varsayılır (`PROVIDER_QUOTE_UNAVAILABLE`) ve müşteri kabulü istenir. Sandbox'ta teklif her zaman 500 döndü (soru 15).
- HTTP 202 (`CANCEL_PENDING`) "havayolu onayı bekleniyor" demektir. Rezervasyon kesinleşene kadar okunur ve iptal yeniden gönderilmez.

### 6. First Line destek

- Yolcunun kendi e-postası ve telefonu rezervasyonun `contact` alanına yazılır. Rehbere göre havayolu değişikliği yolcuya ancak kendi iletişim bilgisi rezervasyondaysa doğrudan ulaşır.
- Onay e-postası ve sipariş sayfası şunu söyler: değişiklik ve iptalleri Nuitée yürütür ve yolcuya doğrudan ulaşır; gönüllü değişiklik veya iptalde havayolu ücretlerine ek olarak 25 USD hizmet bedeli yolcunun kartından alınır.
- Nuitee'nin yolcuya açık destek kanalı (telefon/e-posta) belgelerde yoktur. Uydurulmadı; Nuitee'ye soruldu (soru 20).

### 7. Yolcu belgeleri saklanmaz

Saklama süresi bir işletme girdisidir (G06, KVKK) ve belirlenmedi. Bu yüzden belge verisi diske yazılmaz:

- Belge türü, numarası, veren ülke ve geçerlilik tarihi; doğum tarihi, cinsiyet ve uyruk her uçuşta formdan alınır.
- Bu veriler yalnız web sürecinin belleğinde (`TransientPassengerDetails`, en çok 10 dakika) prebook'a kadar tutulur, prebook'ta Nuitee'ye gönderilir ve okununca silinir. Veritabanına, loglara, outbox'a ya da denetim kaydına yazılmaz. Entegrasyon testi (`flights.int.test.ts`) misafir, teklif, idempotency, denetim ve outbox tablolarında belge numarası ve doğum tarihi arayarak bunu doğrular.
- Veritabanında yalnız yolcu adı, soyadı ve yolcu tipi tutulur. Bunlar operasyon ve müşteri hizmeti için gereklidir.
- Idempotency kaydı isteğin yalnız SHA-256 özetini saklar.
- Aynı istek tekrarlanırsa belgeler, ödeme oturumu henüz açılmadıysa yeniden prebook'a verilir. Belge bellekte bulunamazsa (yeniden başlatma, başka süreç) prebook gönderilmez, sipariş para hareketi olmadan biter ve müşteri bilgileri yeniden girer.
- İşletme belgeleri saklamak isterse önce saklama süresi ve erişim politikası belirlenmelidir. Bu ayrı bir iş paketidir: şifreleme, süre dolunca silme ve erişim kaydı gerekir.

### 8. Uçak marjı panelden

- Onaylı fiyat politikasındaki `FLIGHT / PROVIDER_MANAGED / PROVIDER_API` yüzdesi her aramada `margin.rateSearch` olarak gönderilir.
- Kural yoksa uçak satışı kapalıdır: menüde "Uçak" görünmez, arama `CAPABILITY_NOT_AVAILABLE` döner. Varsayılan marj yoktur.
- Nuitee marj tutarını göndermez, ama yalnız toplam fiyatın marj içerdiğini belgeler. Bu yüzden uygulanan marj `toplam − (taban + vergi + ücret)` olarak hesaplanır ve onaylı kuralla 5 baz puan toleransla karşılaştırılır.
- Tutmayan teklif satılmaz. Örnek: hesapta marj düzenleme kapalı olduğu için hesap varsayılanı uygulanmışsa.
- Sandbox kanıtı (R0 §10.4):
  - %0 marjda 132 teklifin hepsinde oran tam 1.
  - %10 marjda oran 1,09991–1,10000; sapma en çok 0,87 baz puan.
- Koltuk, bagaj ve ceza marjları gönderilmez ve hesap ayarına tabidir (soru 18).
- Satış noktası (`FLIGHT_POINT_OF_SALE`) bir ayardır. Boşsa Nuitee varsayılanı kullanılır.

## Sonuçlar

- Sağlayıcıya özgü davranış porttadır, orkestratör ürün bilmez:
  - `ProviderManagedBookingPort.bookTrigger` ve `lookupScope`;
  - `ProductProviderManagedPort` (her sipariş kendi ürününün portuna gider);
  - `ISSUANCE_CHECK` adımı.
- Web ve worker aynı kuralları kullanır. Worker uçak prebook'u yapmaz, çünkü belgeler onda yoktur.
- Otel akışı değişmedi (mevcut testler aynen geçiyor).
- MOCK uçak bağlayıcısı production'da reddedilir. Ödenmemiş book'u production'ın yaptığı varsayılan şekilde reddeder ve bunu MOCK kodla işaretler.

## Açık kalanlar

- Soru 11: production'da ödemesiz book'un reddedildiği ve ret kodu.
- Soru 16: biletleme kanıtı.
- Soru 14: iade hedefi.
- Soru 20: First Line yolcu iletişim kanalı.
- Soru 21: production hesabında marj düzenleme.
- Koltuk ve bagaj ek hizmetleri (T07).
- Belge saklama politikası, işletme isterse.
