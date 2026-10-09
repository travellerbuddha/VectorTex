# ADR-0003 — `cms` ve `core` şema ayrımı

- Durum: Kabul edildi (2026-10-09)

## Karar

- Tek PostgreSQL veritabanı, iki şema: `cms` (Payload `@payloadcms/db-postgres`, `schemaName: 'cms'`) ve `core` (Drizzle, `packages/db`).
- Payload migration'ları yalnız `cms`'e, `packages/db/migrations` yalnız `core`'a dokunur. Drizzle config `schemaFilter: ['core']`.
- Üretimde iki ayrı DB rolü önerilir: `cms_app` (`cms` üzerinde yazma, `core` üzerinde hiçbir yetki) ve `core_app` (`core` yazma). Payload'ın `core`'a erişimi yoktur; `/yonetim` operasyon ekranları core'u Payload koleksiyonu olarak değil, core API üzerinden okur.
- Finansal gerçek (Order, PaymentAttempt, LedgerEntry, QuoteVersion fiyat snapshot'ı) yalnız `core`'dadır. İçerik editörü fiyat/durum değiştiremez.

## Sonuç

- `cms` ↔ `core` arasında foreign key yoktur; ilişki opaque kimlikle (ör. destinasyon slug) kurulur.
- Rezervasyon durumu Payload admin'inde CRUD alanı olarak görünmez.

## Uygulama (P06, 9 Ekim 2026)

- **Sürüm:** Payload 3.90.2, `@payloadcms/next`, `@payloadcms/db-postgres` ve `@payloadcms/richtext-lexical` 3.90.2. Bu sürümler Next 16.3.8, React 19.2.8 ve Drizzle 0.45.2 ile aynı kilitte (ADR-0001).
- **Migration:** Şema değişikliği yalnız commit'lenmiş migration'larla yapılır (`apps/web/src/payload/migrations`, `pnpm cms:migrate`). `push` kapalıdır. İlk migration `cms` şemasını kendisi oluşturur; 52 tablonun hepsi `cms` içindedir.
- **Veritabanı rolü:** `PAYLOAD_DATABASE_URL` ile Payload ayrı bir rolle bağlanabilir. Panel oturumunu doğrulayan kod `core` havuzunu (`DATABASE_URL`) kullanır, Payload'ın havuzunu kullanmaz. Entegrasyon testi, yalnız `cms` yetkili bir rolün `core.orders` ve `core.payment_attempts` tablolarına erişemediğini doğrular (`apps/web/test/cms.int.test.ts`).
- **Giriş:** Payload'ın kendi şifreli girişi kapalıdır (`disableLocalStrategy`). Özel strateji `/yonetim` oturumuna güvenir: oturum aktif olmalı (şifre + MFA) ve kişinin `content.edit` ya da `content.publish` izni bulunmalıdır. İzinler her istekte yeniden okunur. CMS kullanıcıları (`cms-users`) personelin aynasıdır; CMS'te oluşturulamaz ve düzenlenemez.
- **Erişim kuralları:**
  - Ziyaretçi yalnız yayınlanmış belgeyi okur.
  - `content.edit` taslak oluşturur ve düzenler.
  - Yayınlama ve silme `content.publish` ister. Taslak kaydında da çalışan bir koruma vardır (`guardPublish`).
  - Menü ve alt bilgi canlı siteyi hemen değiştirir; bu yüzden iki izin de gerekir.
  - Site Local API ile `overrideAccess: false` kullanarak okur. Önizleme, içerik personelinin kendi kullanıcısıyla yapılır.
- **İçerik modeli:**
  - Koleksiyonlar: sayfa, destinasyon, rehber yazısı, SSS, kampanya, görsel.
  - Globaller: menü ve alt bilgi.
  - Dil: TR/EN; Türkçe varsayılan ve yedek dil.
  - Sayfa blokları yalnız onaylı listedendir: giriş/arama, metin, görsel + metin, SSS, destinasyon listesi, kampanya bandı. Serbest HTML, script veya ödeme bloğu yoktur.
  - Kampanyalarda fiyat, oran ya da tutar alanı yoktur.
  - Sayfa adresleri rezervasyon ve panel yollarıyla çakışamaz.
  - Bağlantılar yalnız site içi adres, `https`, `mailto` veya `tel` olabilir.
- **Medya:** staging/production ortamında S3 zorunludur (`CMS_S3_*`, resmî `@payloadcms/storage-s3` eklentisi). Hesap ve bucket henüz yok; bu kurulum **doğrulanmadı**. Geliştirme ve test ortamında yerel disk kullanılır.

