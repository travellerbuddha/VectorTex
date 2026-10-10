# ADR-0019 — Komisyon hak edişi ve tahsilatı (EXPECTED → EARNED → RECEIVED)

- Durum: Kabul edildi (2026-10-10).
- İlgili: ADR-0006 (komisyon alacağı), ADR-0008 (Nuitee tahsilatlı akış), ADR-0015 (finans raporu), şartname §6 (müşteri parası, tedarikçi borcu ve komisyon ayrı), `docs/r0/saglayici-sorulari.md` soru 1.

## Bağlam

Nuitee tahsilatlı satışta müşteri tutarı bizim marjımızı içerir. Nuitee bu komisyonu misafir çıkış yaptıktan sonra haftalık payout ile öder. Bu bilgi pinned `nuitee-guide-revenue-commission` dokümanından gelir; production'da teyit edilecektir.

Kod şimdiye kadar yalnız iki şeyi yapıyordu:
- komisyonu onayda `EXPECTED` olarak kaydetmek;
- iptalde `VOIDED` yapmak.

`EARNED` ve `RECEIVED` geçişleri bekliyordu, çünkü Nuitee'nin payout bildiriminin biçimi bilinmiyor. Ancak tahsilatı kaydetmek için o biçime gerek yok: finans, ödemeyi banka dekontundan veya Nuitee bildiriminden elle kaydedebilir.

## Karar

**Hak ediş (worker, saatlik):**
- Komisyonun `EARNED` olması için iki koşul gerekir:
  - hizmet bitmiş olmalı: otelde çıkış günü, uçakta son uçuş günü (İstanbul tarihiyle) geçmiş, yani bugün bu tarihten sonra;
  - Nuitee o anda yeniden okunmalı ve rezervasyonu hâlâ onaylı göstermeli.
- Okuma, sipariş ekranındaki "Durumu kontrol et" komutuyla aynı yoldan yapılır (`GET /bookings/{id}`).
- Nuitee rezervasyonu iptal göstermişse sipariş iptale döner ve komisyon `VOIDED` olur.
- Yanıt yoksa ya da aynı sipariş için başka çağrı sürüyorsa hiçbir şey değişmez; bir sonraki çalışmada yeniden denenir. Tahmine dayanarak hak ediş yazılmaz.
- Hak edişte muhasebe kaydı yapılır: borç `asset:commission_receivable:<sağlayıcı>`, alacak `revenue:provider_commission:<sağlayıcı>`. Onayda kayıt yoktur; onay, gelir değildir.
- Kendi ödememizdeki (iyzico) siparişlerin hak edişi o entegrasyonla gelecek. Sağlayıcı orada başka bir yoldan okunur.

**Tahsilat (finans, `commissions.record_payout`):**
- Ekran: `/yonetim/raporlar/komisyonlar`.
- Finans, ödemenin kapsadığı `EARNED` komisyonları seçer ve şunları girer: gelen tutar, hesaba geçtiği gün, ekstre/payout referansı.
- Ekranda seçilen komisyonların toplamı canlı görünür.
- Komisyonlar `RECEIVED` olur. Muhasebe kaydı:
  - borç `asset:payout_clearing:<sağlayıcı>` (gelen tutar);
  - alacak `asset:commission_receivable:<sağlayıcı>` (her komisyon).
- Gelen tutar seçilen toplamdan farklıysa (ör. banka masrafı) açıklama zorunludur. Fark ayrı hesaba yazılır:
  - eksik gelmişse: `expense:commission_shortfall`;
  - fazla gelmişse: `revenue:commission_adjustment`.
- Bir referans, sağlayıcı başına bir kez kaydedilir.
- Tarih ileri olamaz. Komisyonlar ödemenin sağlayıcısında ve para biriminde olmalıdır. Kur çevrimi yapılmaz.

**İptal ve geri alma:**
- Hak edildikten sonra iptal edilen rezervasyonda `EARNED → VOIDED` yapılır ve hak ediş kayıtları ters kayıtla geri alınır (`reverses_entry_id`).
- Tahsil edilmiş (`RECEIVED`) komisyon iptal edilmez. Siparişe `commission.cancelled_after_payout` denetim kaydı düşer ve konu finansa kalır.

**Veritabanı güvenceleri (`0017_commission_lifecycle`):**
- Durum yalnız ileri gider. İzin verilen geçişler:
  - `EXPECTED → EARNED | VOIDED`;
  - `EARNED → RECEIVED | VOIDED`.
- Hak ediş zamanı, payout ve referans yalnız bir kez yazılır.
- `EARNED` ve `RECEIVED` için hak ediş zamanı, `RECEIVED` için payout zorunludur.
- Payout, yalnız kendi ortamı, sağlayıcısı, para birimi ve referansıyla eşleşen komisyonları kapatabilir.
- Payout'un kapattığı komisyonların toplamı, kayıttaki toplama commit anında eşit olmalıdır. Hiçbir komisyonu kapatmayan payout reddedilir.
- `commission_payouts` yalnız eklenir; güncellenemez, silinemez.

**Yetki:**
- Görüntüleme: `orders.view_financials`.
- Kayıt: yeni izin `commissions.record_payout`. FINANCE ve OWNER_ADMIN ön ayarlarında vardır, FINANCE_APPROVER'da yoktur.

## Sonuçlar

- Finans raporunda şunlar görünür:
  - dönemde gelen ödemeler (hesaba geçtiği güne göre);
  - bugünkü açık alacak (`EXPECTED` + `EARNED`).
- Nuitee'nin payout bildirimi/raporu netleşince eşleştirme otomatikleştirilebilir (dosya içe aktarma veya API). Elle kayıt yolu aynı kalır.
- Muhasebe yazılımına aktarım ve fatura/vergi modeli G06'ya (finans/hukuk) bağlıdır. `payout_clearing` hesabını banka hesabıyla muhasebe eşleştirir.
- Yerel demoda bir komisyon "hak edildi" olarak hazırlanır (DEMO işaretli). Böylece ekran denenebilir.
- Test kapsamı:
  - `packages/booking/test/commissions.int.test.ts`: tarih, yeniden okuma, dış iptal, yanıtsızlık, ters kayıt, yetki, doğrulamalar, fark açıklaması, tek referans, defter dengesi;
  - `packages/db/test/commission.int.test.ts`: DB güvenceleri;
  - `packages/admin/test/finance.int.test.ts`: rapor;
  - `apps/web/e2e/admin-commissions.spec.ts`: ekran.
