# ADR-0006 — Kendi tahsilat yolunda Nuitee marjı: API `margin` parametresi

- Durum: Kabul edildi (2026-10-09). İşletme kararı: Satış Müdürü, "B seçeneği".
- Değiştirdiği kural: şartname §6 "Otelde kendi tahsilat yolu net oran (`margin: 0`) + tek yerel fiyatlandırma katmanı kullanır." Bu kural Nuitee oteli için artık zorunlu değildir. K01–K15 değişmez. "İki kez marj eklenmez" kuralı aynen geçerlidir.
- Kanıt: `docs/r0/R0-kanit-raporu.md` §10 ve §10.1, `contracts/capability-matrix.json` → `nuitee.hotel.own_gateway.account_card`.

## Bağlam

Sandbox'ta `margin: 0` ile aranan net fiyatlar prebook'ta 7 denemenin 7'sinde reddedildi (HTTP 409, kod 2001). %0,5, %1, %5, %10, %12,5 marjlar ve hesap varsayılanı ise sorunsuz geçti. Bu durumda "net fiyat + yerel marj" kuralıyla otel satılamıyordu. İşletme B seçeneğini seçti: marj, kendi ödememizde de Nuitee API'sinin `margin` alanıyla uygulanacak.

## Karar

1. **Tek kaynak bizim fiyat politikamızdır.** Marj yüzdesi yalnız onaylı, sürümlü fiyat politikasında tutulur ve /yonetim'de kullanıcı tarafından değiştirilir: taslak → dört göz onayı → aktif (G06). Her aramada `margin` açıkça gönderilir. Nuitee panelindeki hesap varsayılan marjı hiçbir zaman devreye girmez.
2. **Hangi üründe hangi uygulama:**

   | Ürün | Kendi ödememiz (`OWN_GATEWAY`) | Nuitee'nin yönettiği ödeme (`PROVIDER_MANAGED`) |
   |---|---|---|
   | Otel, Uçak | `LOCAL` veya `PROVIDER_API` (politikada seçilir) | `PROVIDER_API` |
   | Tur/aktivite, Transfer | yalnız `LOCAL` (sözleşmede istek marj alanı yok) | Tur/aktivite: belgelenmiş marj alanı yok |

   Otel ve uçak için `margin` istek alanı kilitli OpenAPI'de belgelidir (`/hotels/rates`, `/flights/rates`). Uçak bağlantısı henüz yok; bu satır yalnız politika düzeyinde açıktır.
3. **Tek marj katmanı.** `PROVIDER_API` uygulamasında yerel marj eklenmez; satış fiyatı Nuitee'nin döndürdüğü komisyon dahil fiyattır. Politikada tanımlanmış servis bedelleri ayrı, görünür kalemlerdir. Kamuya açık fiyatta SSP tabanı uygulanır; SSP'ye yükseltme farkı bizim tahsilatımızda kalan yerel gelirdir, komisyon değildir. (Nuitee tahsilatlı satışta yükseltme yapılamaz; orada SSP altı tekliflerin gösterilip gösterilmeyeceği ADR-0009'daki politika ayarıyla belirlenir.)
4. **Doğrulama.** Nuitee'nin bildirdiği `commission`, istediğimiz marja yuvarlama payı içinde eşit olmalıdır: tolerans net fiyatın 5 baz puanıdır, en az 1 alt birim. Sandbox'ta görülen en büyük sapma 0,15 baz puandı. Fark daha büyükse fiyat kullanılmaz (`MARGIN_MISMATCH`, yeniden arama). Böylece hesap varsayılanı, ek markup ya da aramadan sonra değişen politika sessizce fiyata giremez. `margin: 0` istenmişse komisyon tam olarak 0 olmalıdır.
5. **Para akışı (kendi ödememiz + `ACC_CREDIT_CARD`):**
   - Müşteriden iyzico ile satış fiyatı tahsil edilir. Bu fiyat komisyonu ve varsa servis bedellerini içerir.
   - Nuitee, komisyon dahil tam fiyatı hesap kartından çeker. Sandbox: maliyet 1.521,09 EUR, rezervasyonda bildirilen komisyon 138,27 EUR, %10 marj.
   - Komisyon, konaklama tamamlanıp misafir çıkış yaptıktan sonra Nuitee'nin haftalık payout'u ile gelir (pinned `nuitee-guide-revenue-commission`). O zamana kadar bu tutar Nuitee'den alacaktır ve bizim çalışma sermayemizden finanse edilir.
6. **Kayıt.** Komisyon alacağı müşteri tahsilatından ve tedarikçi borcundan ayrı tutulur (§6):
   - `core.quote_versions.provider_commission_minor`: kabul edilen teklifte tedarikçi maliyetine dahil beklenen komisyon. DB kuralı: 0 ≤ komisyon ≤ maliyet.
   - `core.provider_bookings.provider_commission_*`: Nuitee'nin rezervasyonda bildirdiği komisyon.
   - `core.provider_commissions`: alacak kaydı. Durum yalnız ileri gider (DB tetikleyicisi). Tutar ve kimlik değişmez, kayıt silinmez, ortam siparişle aynı olmalıdır (T15). Rezervasyon onayında ledger kaydı yapılmaz: onay hak ediş değildir (§6).

     | Durum | Anlamı | Ne zaman |
     |---|---|---|
     | `EXPECTED` | Bekleniyor; Nuitee'nin bildirdiği tutar, yoksa teklifteki tutar | Rezervasyon onayında |
     | `EARNED` | Hak edildi | Konaklama sonrası (P15) |
     | `RECEIVED` | Tahsil edildi; payout referansı zorunlu | Payout geldiğinde |
     | `VOIDED` | Geçersiz | Rezervasyon iptal edilirse |

## Sonuçlar

- **Risk ve çalışma sermayesi:** Hesap kartı komisyon dahil tutarla yüklenir. Komisyon, konaklama sonrasına kadar Nuitee'den alacak olarak kalır. **İşletme kararı (9 Ekim 2026): komisyon alacağı için üst limit yoktur.** Bekleyen komisyon toplamı yine de `provider_commissions` kayıtlarından izlenebilir (P15 raporu).
- **İptal:** Ücretsiz iptalde Nuitee tutarın tamamını (komisyon dahil) iade etti (sandbox kanıtı). Cezalı iptalde komisyon ödenip ödenmediği belgede yok. Kayıt temkinli olarak `VOIDED` yapılır; soru Nuitee'ye iletildi (`docs/r0/saglayici-sorulari.md`).
- **Mutabakat:** `EXPECTED → EARNED → RECEIVED` geçişleri, payout ekstresi eşleştirmesi ve muhasebe kayıtları P15 kapsamındadır. Fatura/vergi modeli G06'ya (finans/hukuk) bağlıdır.
- **Geri dönüş:** Net fiyat yolu (`LOCAL`) kodda korunur. Nuitee `margin: 0` ile prebook'u açarsa finans, yeni bir politika sürümüyle `LOCAL`'a dönebilir; kod değişikliği gerekmez.
