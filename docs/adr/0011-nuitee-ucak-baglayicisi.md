# ADR-0011 — Nuitee uçak bağlayıcısı: sözleşme, belirsiz yanıtlar ve biletleme

- Durum: Kabul edildi (2026-10-09), bağlayıcı düzeyinde. Aşağıdaki işletme kararları 2026-10-10'da verildi; müşteri uçak akışı ADR-0012'dedir.
- İlgili: ADR-0002 (katman ayrımı), ADR-0006 (API marjı), ADR-0008 (önce Nuitee tahsilatlı akış), şartname T07/T08/T19, `docs/r0/R0-kanit-raporu.md` §10.3, Nuitee soruları 11–19.

## Bağlam

İlk `FlightConnector` sözleşmesi doküman kilitlenmeden yazılmıştı ve belgelenmiş API ile uyuşmuyordu:

- uçakta `clientReference` ile sorgu yok (`GET /flights/bookings` yalnız havayolu PNR'ı + soyadı ile arar);
- iptal teklifi bir "teklif referansı" döndürmüyor;
- otel tarzı iptal politikası (tarihli ceza adımları) yok, yalnız iade edilebilir/değiştirilebilir bayrakları ve sağlayıcı metni var.

## Karar

1. **Sözleşme belgelenmiş API'ye göre yeniden yazıldı** (`packages/contracts/src/ports/connectors.ts`): arama → doğrulama → prebook → book → durum → iptal teklifi → iptal.
   - Uçak teklifleri otel `QuotedOffer` tipine zorlanmaz. Boş ceza adımlı bir iptal politikası, mevcut `penaltyAt` hesabında "cezasız" okunurdu. İptalin maliyeti yalnız rezervasyondan sonra iptal teklifiyle bilinir.
2. **Kayıp yanıt çözümü belgelenmiş idempotency'dir.** `POST /flights/bookings` aynı prebook ile tekrarlanınca mevcut rezervasyonu döndürür. Bu yüzden şu yanıtların hepsi UNKNOWN'dır ve aynı prebook ile tekrar sorulur:
   - zaman aşımı,
   - 5xx,
   - 409 (eşzamanlı işlem, yinelenen, zaten biletlenmiş),
   - 429.
   Müşteri referansımız rezervasyona `customTags.TH_REF` etiketiyle yazılır. Başka referans taşıyan bir yanıt kabul edilmez.
3. **Prebook bir rezervasyon yaratır** (rehber: "koltuk burada tutulur"), ama kimliği olmadan bulunamaz.
   - Yanıtı kaybolan prebook UNKNOWN döner ve otomatik tekrarlanmaz.
   - Para riski yoktur: ödeme `secretKey`, rezervasyon `prebookId` gerektirir ve ikisi de bize ulaşmamıştır.
   - Terk edilen prebook'un maliyeti Nuitee'ye sorulmuştur (soru 17).
4. **PNR bilet değildir (T08).** Normalize `CONFIRMED` durumu biletlenmiş rezervasyonu da kapsar (TICKETED→CONFIRMED). Bilet yalnız şu ikisinden biriyle kabul edilir:
   - `ticketData.ticketedAt`,
   - `order.status = "ticketed"`.
   Havayolu PNR'ı olan ama bilet verisi olmayan rezervasyon `CONFIRMED` + biletleme `PENDING` sayılır.
5. **İptal:**
   - HTTP 200 kesin sonuçtur (`CANCELLED`).
   - HTTP 202 "havayolu onayı bekleniyor" demektir (`CANCEL_PENDING`). OpenAPI 202 gövdesinde yalnız `CONFIRMED` durumunu listeler. Sandbox, henüz onaylanmamış rezervasyon için 202 + `CREATED` döndürdü. Bu yüzden rezervasyonun bekleyen her durumu kabul edilir.
   - `cancelIntentAt` dolu ve durum kesin iptal değilse rezervasyon `CANCEL_PENDING` sayılır (sandbox: `CREATED` + `cancelIntentAt`).
   - 409 "zaten iptal", "eşzamanlı" ve "henüz kesin değil" durumlarını aynı kodla kapsar, bu yüzden UNKNOWN'dır ve rezervasyon okunarak çözülür.
   - İadenin kime gittiği (`destination`) olduğu gibi raporlanır, varsayılmaz.
6. **Fiyat ve marj:**
   - `margin.rateSearch` her aramada açıkça gönderilir: politika yoksa 0. Böylece hesap düzeyindeki havayolu/rota ayarları sessizce uygulanmaz (ADR-0006).
   - Koltuk, bagaj ve ceza marjları gönderilmez ve hesap ayarına tabidir. Bu bir işletme kararıdır (G06). ADR-0013 ile değişti: dört kategori de politikadan açıkça gönderilir.
   - Müşteriden çekilecek tutar prebook `price` alanıdır (ödeme oturumunun tutarı). Akış bu tutarı müşterinin kabul ettiği fiyatla karşılaştırır.
7. **Yönlendirme izlenmez.** Belgelenmiş `POST /flights/bookings` yolu sandbox'ta 307 ile `/flights/bookings/` adresine yönlendiriyor. Taşıyıcımız API anahtarı başka adrese gitmesin diye yönlendirme izlemez, bu yüzden bağlayıcı sondaki eğik çizgili yolu doğrudan çağırır. Bu, ilk sandbox koşusunda yakalandı: istek rezervasyon işleyicisine hiç ulaşmadı ve sonuç UNKNOWN döndü.
8. **CREDIT yalnız production'da.** Kredi hattıyla yapılan rezervasyon gerçektir. Ödeme bileşeni dışındaki yöntemler (`ACC_CREDIT_CARD`, `CREDIT`) sözleşmede belgelenmiştir ama hesap kanıtı yoktur (G02).

## Sandbox'ın kanıtlayamadıkları

- **Ödemeden önce rezervasyon:** Sandbox ödemesiz isteği kabul etti ve onayladı. Rehbere göre production reddeder. Akış rezervasyonu yalnız ödeme bileşeni döndükten sonra yapar. Production davranışı yazılı teyit bekliyor (soru 11).
- **İptal teklifi:** Sandbox'ta her zaman HTTP 500 (59099) döndü (soru 15).
- **Biletleme:** Sandbox bir koşuda ~3 dakikada `ticketData.ticketedAt` ile biletledi; bilet numarası yapay (PNR ile aynı) ve `ticketData.tickets[]` OpenAPI'de yok. Production biletleme kanıtı ve bilet numarası alanı teyidi bekleniyor (soru 16).

## İşletme kararları (2026-10-10'da verildi, ADR-0012: First Line, belge her uçuşta ve saklanmadan, panelden yüzde marj)

1. **Destek modeli:** First Line ya da B2B-Relayed.
   - First Line: yolcu doğrudan Nuitee ile konuşur, servis ücreti yolcunun kartından alınır.
   - B2B-Relayed: yolcu bizim ekibimizle konuşur, maliyet kredi hattımıza yansır.
   - Gönüllü değişiklik başına 25 USD servis ücreti iki modelde de vardır.
2. **Yolcu kimlik/belge politikası (G06, KVKK):** hangi belge alanlarının istendiği, nasıl saklandığı ve ne kadar süre tutulduğu.
3. **Uçak marjı:** onaylı fiyat politikasında `FLIGHT` kuralı. Koltuk, bagaj ve ceza marjları ayrıca kararlaştırılmalı.
4. **İptal iadesinin müşteriye nasıl döneceği:** Nuitee cevabına bağlı (soru 14).
