# ADR-0013 — Uçakta koltuk ve bagaj: ödeme formundan önce, yeni teklif sürümüyle

- Durum: Kabul edildi (2026-10-10).
- İlgili: ADR-0006 (API marjı), ADR-0011 (uçak bağlayıcısı), ADR-0012 (müşteri uçak akışı), K15/T04, T07, G06, R0 §10.5, Nuitee sorusu 22.

## Bağlam

Nuitee uçak prebook'una koltuk ve ek bagaj eklenebilir (`POST /flights/prebooks/{id}/services`). Belgelere göre:

- Ekleme yeni bir ödeme niyeti oluşturur: yeni `transactionId` ve `secretKey`, yeni tutar. Eski niyet kullanılmamalıdır ("stale one will result in a payment mismatch").
- Katalog ve geçerli niyet `GET /flights/prebooks/{id}` ile okunur.
- Ek hizmet marjları (`margin.seats`, `margin.bags`) aramada gönderilir ve teklife bağlanır. Gönderilmeyen kategori hesap ayarını kullanır.

İşletme kararı (2026-10-10): uçak marjı panelden yüzde olarak girilir; koltuk, bagaj ve ceza marjları ayrı girilir.

## Karar

### 1. Fiyat politikası

- Uçak (`FLIGHT / PROVIDER_API`) kuralına üç isteğe bağlı oran eklendi: koltuk, bagaj, iptal/değişiklik cezası.
  - /yonetim'de girilir ve dört göz onayından geçer.
  - Şema bu oranları yalnız uçak sağlayıcı marjında kabul eder.
- Her aramada dört kategori de açıkça gönderilir: `rateSearch`, `seats`, `bags`, `penalties`. Değeri olmayan kategori **0** gider; hesap varsayılanı sessizce uygulanmaz.
- Oranı girilmemiş koltuk veya bagaj **satılmaz**. Bu bilgi teklif sürümüne yazılır (`extras`).
- Not: Önceden `seats/bags/penalties` hiç gönderilmiyordu ve hesap ayarı geçerliydi. Artık ceza marjı da politikadan gelir; politikada yoksa 0'dır.

### 2. Ek hizmet yalnız ödeme formu gösterilmeden önce

- Ödeme formu için gereken secret müşterinin tarayıcısına ilk kez verildiğinde bu an kaydedilir (`payment_attempts.provider_secret_issued_at`).
  - Bu andan sonra müşteri ödeme yapabilir.
  - Bu yüzden ödeme niyeti artık değiştirilemez ve ek hizmet eklenemez.
  - Böylece "eski niyetle ödendi, yenisiyle rezervasyon yapıldı" durumu oluşamaz.
- Akış: yolcu formu → **Koltuk ve bagaj** sayfası (isteğe bağlı) → ödeme.
  - Sunulacak bir şey yoksa sayfa doğrudan ödemeye geçer. Örnekler: politika oran tanımlamamış, havayolu desteklemiyor, katalog boş, süre dolmuş.
- Katalog her seferinde sağlayıcıdan canlı okunur.
  - Prebook'un tutarı ve niyeti siparişteki ile aynı olmalıdır; değilse hiçbir şey sunulmaz.
  - Sağlayıcı kimlikleri tarayıcıya gitmez; tarayıcı yalnız bunların özetinden üretilen anahtarları görür.
- Kurallar:
  - her yolcu ve uçuş için en fazla bir koltuk ve bir bagaj;
  - bebeğe koltuk verilmez;
  - dolu koltuk seçilemez;
  - yolcu tipi hizmete uymalıdır;
  - fiyat sipariş para biriminde olmalıdır.

### 3. Fiyat ve kabul (K15)

- Müşteri sayfadaki toplamı kabul ederek gönderir. Sunucu toplamı yeniden hesaplar: mevcut tutar + canlı fiyatlar.
  - Toplam farklıysa hiçbir şey gönderilmez (`QUOTE_CHANGED`).
- Eşitse önce **yeni bir teklif sürümü** oluşturulur ve kabul edilmiş olarak kaydedilir: önceki sürüm + hizmet satırları + uçuş ücreti. Sonra sağlayıcı çağrılır.
- Sağlayıcı tam bu tutarı isterse:
  - yeni niyet ve secret siparişe yazılır;
  - sipariş toplamı, kalem payı, maliyet ve ödeme tutarı yeni teklif sürümüyle birlikte güncellenir (tek işlem, sürüm kontrollü);
  - veritabanı kalem paylarının toplama eşitliğini commit anında denetler.
- Sağlayıcı farklı bir tutar isterse checkout ödeme alınmadan biter (`PRICE_CHANGED`). Yeni niyet müşteriye hiç gösterilmez.
- Sandbox'ta tutar kuruşu kuruşuna tuttu: 38,22 € + koltuk 11,58 € = 49,80 € (R0 §10.5).

### 4. Belirsiz sonuç

- Ekleme çağrısından önce `SERVICES` niyeti (intent) kaydedilir.
- Sağlayıcı açıkça reddederse (4xx) hiçbir şey değişmez; müşteri yeniden seçebilir. Reddedilen denemenin teklif sürümü kullanılmadan kalır; sonraki deneme bir sonraki sürüm numarasını alır.
- Yanıt kaybolursa (zaman aşımı, 5xx, 409) çağrı **tekrarlanmaz**; prebook okunur (`GET`):
  - niyet değişmiş ve tutar beklenen → eklendi sayılır;
  - niyet ve tutar değişmemiş → eklenmedi sayılır, müşteri yeniden seçebilir;
  - okunamadı veya okuma reddedildi → checkout ödeme alınmadan biter (eski niyet artık geçersiz olabilir).
- Niyet aynı kalıp tutar değişirse (belgelenmeyen durum) checkout ödeme alınmadan biter (`SERVICES_UNCONFIRMED`).
- Süresi dolan `SERVICES` niyeti de checkout'u ödeme alınmadan bitirir (`SERVICES_UNCONFIRMED`). Bu durumda provizyon görevi açılmaz, çünkü form hiç gösterilmemiştir.

### 5. Provizyon bildirimi

Ödemesi alınmamış bir uçak checkout'u süre dolunca kapanır. "Kartınızda provizyon olabilir" görevi ve e-postası artık yalnız ödeme formu müşteriye gerçekten gösterildiyse açılır (ADR-0012'deki "her zaman" yerine).

### 6. Görünüm

- Müşteri sayfası, onay e-postası ve /yonetim sipariş detayı eklenen hizmetleri yolcu ve uçuş bazında gösterir. Sağlayıcı kimliği gösterilmez.
- Uçuş ücreti ile toplam ayrı görünür.

## Sandbox'ın gösterdikleri (R0 §10.5)

- Katalog yapısı:
  - Gruplarda `available` alanı yok. Bağlayıcı yalnız açıkça `false` olan grubu kapatır.
  - Bazı koltuklar 0 fiyatlı ("dahil").
- Belgelenmemiş alanlar: `notSupported` ve `providerErrors` ("CARRIER_NOT_SUPPORTED"). Bu durumda katalog boş gelir ve hiçbir şey sunulmaz.
- POST yanıtı eklenen hizmetleri listelemedi; GET listeledi. Bu yüzden belirsiz sonuç prebook okunarak çözülür.
- İki rotada da bagaj teklifi yoktu. Bagaj akışı yalnız MOCK ve sözleşme testleriyle doğrulandı; sandbox kanıtı yok.

## Açık kalanlar

Nuitee sorusu 22: koltuk/bagajın havayolunca kesinleşmesi, sonradan reddedilirse iade, hizmet marjının görünürlüğü, eski niyetin durumu ve belgelenmemiş alanlar. Rezervasyondan sonra hizmet ekleme API'de henüz yok (belge).
