# ADR-0019 — Komisyon tahsilatı ve hak edişi

- Durum: Kabul edildi (2026-10-10). **2. sürüm (2026-10-10):** hesap sahibinin bilgisine göre ödeme zamanı düzeltildi.
- İlgili: ADR-0006 (komisyon alacağı), ADR-0008 (Nuitee tahsilatlı akış), ADR-0015 (finans raporu), şartname §6 (müşteri parası, tedarikçi borcu ve komisyon ayrı; onay hak ediş değildir), `docs/r0/saglayici-sorulari.md` soru 24.

## Bağlam

Nuitee tahsilatlı satışta müşteri tutarı bizim marjımızı (komisyonumuzu) içerir.

- Pinned gelir dokümanına göre komisyon konaklama sonrası haftalık ödenir.
- Hesap sahibi ise şunu bildirdi (2026-10-10): **Nuitee, müşterinin ödemesini aldığında komisyonu hesabımıza gönderiyor.** Yani para çoğu zaman konaklamadan önce gelir.

İlk sürüm yalnız hak edilmiş (konaklaması bitmiş) komisyonun tahsilatını kaydedebiliyordu; konaklamadan önce gelen ödeme kaydedilemiyordu. Şartname §6'ya göre de rezervasyon onayı hak ediş değildir: gelir, konaklama bitince oluşur. Bu yüzden iki bilgi ayrı tutulur:
- para geldi mi (tahsilat);
- konaklama bitti mi (hak ediş).

## Karar

**Durumlar:**

| Durum | Anlamı | Muhasebe |
| --- | --- | --- |
| `EXPECTED` | Onaylı, ödenmedi, konaklama sürüyor | Kayıt yok |
| `EARNED` | Ödenmedi, konaklama bitti | Alacak / gelir |
| `RECEIVED`, `earned_at` boş | **Peşin tahsil**: ödendi, konaklama sürüyor | Banka (geçici) / **alınan avans** |
| `RECEIVED`, `earned_at` dolu | Ödendi ve hak edildi | Avans → gelir |
| `VOIDED`, ödenmemiş | İptal | Hak edilmişse ters kayıt |
| `VOIDED`, ödenmiş, mahsup yok | **Nuitee'ye iade/mahsup edilecek** | Avans → iade borcu |
| `VOIDED`, ödenmiş, mahsup edildi | İade bir ödemeden düşüldü | İade borcu kapandı |

**Tahsilat (finans, `commissions.record_payout`, `/yonetim/raporlar/komisyonlar`):**
- Gelen ödeme, ekstre/ödeme referansı, tarih ve tutarla kaydedilir.
- Ödemenin kapsadığı komisyonlar seçilir; ödenmemiş her komisyon seçilebilir, konaklaması bitmiş olsun olmasın.
- Nuitee iptal edilen bir rezervasyonun komisyonunu bu ödemeden düştüyse o da seçilir.
- Beklenen tutar = seçilen komisyonlar − düşülen iadeler. Seçim yapılırken ekranda canlı gösterilir.
- Fark varsa açıklama zorunludur. Fark ayrı hesaba yazılır:
  - eksik gelmişse gider (`expense:commission_shortfall`);
  - fazla gelmişse gelir düzeltmesi (`revenue:commission_adjustment`).
- Kurallar:
  - İadeler tamamı düşülebilir; o zaman hiç para gelmez (0).
  - Düşülen iadeler aynı ödemedeki komisyonları aşamaz.
  - Referans, sağlayıcı başına bir kez kaydedilir.
  - Tarih ileri olamaz.
  - Seçilen her şey ödemenin sağlayıcısında ve para biriminde olmalıdır.
- Muhasebe kaydı:
  - Gelen tutar banka geçiş hesabına (`asset:payout_clearing`) yazılır.
  - Komisyonun konaklaması bitmişse alacak (`asset:commission_receivable`) kapanır; bitmemişse alınan avansa (`liability:commission_received_in_advance`) yazılır.
  - Düşülen iade, iade borcunu (`liability:commission_refund_due`) kapatır.

**Hak ediş (worker, saatlik):**
- Hizmetin bitişinin ertesi günü (İstanbul tarihi; otelde çıkış, uçakta son uçuş) Nuitee yeniden okunur.
- Rezervasyon hâlâ onaylıysa komisyon hak edilir:
  - ödenmemişse `EARNED` olur (alacak / gelir);
  - peşin ödenmişse `earned_at` yazılır (avans → gelir).
- Nuitee yanıt vermezse bir şey değişmez; sonraki çalışmada yeniden denenir.
- Rezervasyon iptal edilmişse sipariş iptale döner.

**İptal:**
- Ödenmemiş komisyon `VOIDED` olur. Hak edilmişse hak ediş kayıtları ters kayıtla geri alınır.
- Peşin ödenmiş, konaklaması bitmemiş komisyon `VOIDED` olur ve **Nuitee'ye iade/mahsup edilecek** listesine düşer. Muhasebede avans iade borcuna geçer.
- Ödenmiş ve hak edilmiş komisyon (konaklama sonrası iptal) değiştirilmez. Siparişe denetim kaydı düşer; konu finansa kalır.

**Veritabanı güvenceleri (`0017`, `0018` migration'ları):**
- Geçişler yalnız ileri gider:
  - `EXPECTED → EARNED | RECEIVED | VOIDED`;
  - `EARNED → RECEIVED | VOIDED`;
  - `RECEIVED → VOIDED` yalnız hak edilmemişken.
- Hak ediş zamanı, ödeme ve mahsup alanları yalnız bir kez yazılır.
- Ödeme ve mahsup, komisyonun ortamı, sağlayıcısı ve para birimiyle eşleşmelidir.
- Bir ödemenin kayıttaki komisyon ve iade toplamları, bağlı satırların toplamına commit anında eşit olmalıdır.
- Ödeme kayıtları yalnız eklenir; düzenlenemez, silinemez.

## Sonuçlar

- Nuitee ödemeyi aldığında gelen komisyon hemen kaydedilir. Konaklama bitene kadar gelir sayılmaz.
- Finans raporunda "açık komisyon" henüz ödenmemiş olanlardır. Peşin tahsil ve iade/mahsup bekleyenler komisyon ekranında ayrı görünür.
- Açık soru: Nuitee, iptal edilen ve komisyonu ödenmiş rezervasyonda komisyonu sonraki ödemeden mi düşüyor, fatura mı ediyor (soru 24)?
  - Fatura ediyorsa, iadenin ayrı ödemeyle kapanması bu ekrana eklenecek.
  - Ekstrede rezervasyon numarası varsa ekstre dosyası otomatik eşleştirilebilir.
- Kendi ödememizdeki (iyzico) siparişlerin hak edişi o entegrasyonla gelecek; iyzico şimdilik ertelendi (işletme kararı, 2026-10-10).
- Test kapsamı:
  - `packages/booking/test/commissions.int.test.ts`: peşin tahsil, iptalde iade borcu, sonraki ödemede mahsup, konaklama sonrası avansın gelire dönmesi, defter dengesi;
  - `packages/db/test/commission.int.test.ts`: DB güvenceleri;
  - `apps/web/e2e/admin-commissions.spec.ts`: ekranda peşin tahsil, iptal ve tam mahsupla sıfır tutarlı ödeme.
