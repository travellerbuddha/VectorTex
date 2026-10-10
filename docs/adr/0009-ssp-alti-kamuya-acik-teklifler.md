# ADR-0009 — Nuitee tahsilatlı satışta SSP altındaki teklifler

- Durum: Kabul edildi (2026-10-09). İşletme kararı (Satış Müdürü): "Biz kapalı gruplara hizmet vermiyoruz. Gizleme, zaten komisyon koyuyoruz üstüne." Sorulan seçenekler: SSP'ye yükseltme (öneri), gizlemeye devam, SSP altında da gösterme. Seçilen: **SSP altında da göster**.
- İlgili: şartname §6 fiyat kuralları ("Kamuya açık otel fiyatında SSP ve dağıtım kısıtları uygulanır"), T02, ADR-0006, ADR-0007, ADR-0008, `nuitee-guide-revenue-commission` (kilitli kaynak).

## Bağlam

- Nuitee, her otel teklifiyle `suggestedSellingPrice` (SSP) döndürür. Bu, otelin herkese açık satış için beklediği en düşük fiyattır.
- Kilitli gelir rehberine göre SSP'nin altında **herkese açık** satış "rate violation" sayılır. Sonuçları: ceza, otel ilişkisinin bozulması ve o otelin fiyatlarına erişimin kesilmesi. SSP altı satış yalnız kapalı kullanıcı gruplarında (üye girişi, uygulama içi) ya da paket içinde serbesttir.
- TexHoliday kapalı grup satışı yapmaz. Bu yüzden sitedeki her fiyat herkese açıktır.
- Nuitee tahsilatlı satışta fiyat, Nuitee'nin net fiyatı ile API marjının toplamıdır. Bu tutarı yerelde yükseltemeyiz. Marj eklemek fiyatın SSP'nin üstüne çıkmasını garanti etmez. Rehberdeki örnekte net 100, SSP 115'tir; %10 marjla fiyat 110 olur ve SSP'nin altında kalır.
- ADR-0008'deki ilk uygulama, SSP'nin altında kalan teklifleri gizliyordu.

## Karar

1. Onaylı fiyat politikasına `allowBelowSspProviderManaged` ayarı eklenir.
   - `true` olduğunda Nuitee tahsilatlı teklifler SSP'nin altında kalsa da gösterilir.
   - `false` olduğunda, ya da ayar yoksa, bu teklifler gizlenir. ADR-0009'dan önce kaydedilmiş politikalar bu yüzden gizlemeye devam eder.
2. Ayar bir işletme girdisidir (G06). Kodda varsayılan olarak açık değildir.
   - Açmak için yeni bir politika sürümü oluşturulur ve ADR-0007'deki izin ve onay kuralıyla onaylanır.
   - Değişiklik denetim kaydına yazılır.
3. Gizlense de gösterilse de her teklif için karşılaştırma kaydedilir:
   - Arama sonucunda, teklif bazında `rateParity` (SSP ve "SSP altında mı").
   - Seçilen teklifin sürümünde (`core.quote_versions.option.rateParity`).

   Böylece SSP altında yapılan her satış siparişten raporlanabilir. Nuitee veya bir otel itiraz ederse liste hazırdır.
4. Kendi ödememizle satışta (iyzico, henüz kapalı) mevcut davranış değişmez. Fiyat SSP'nin altındaysa SSP'ye yükseltilir (`applySspFloor`). Bu hem kurala uyar hem de fark gelir olarak bize kalır. iyzico açılırken bu tutarlılık yeniden değerlendirilir.
5. Sandbox'ın SSP değerleri yapaydır (R0 §10.2). `SANDBOX_SKIP_RATE_PARITY` yalnız sandbox içindir ve bu kararı etkilemez.

## Sonuçlar ve risk

- Daha fazla otel ve oda satışa çıkar. Fiyatlar net + marj olarak kalır.
- **Risk işletmeye aittir ve bilinerek kabul edilmiştir:** SSP altı herkese açık satış nedeniyle Nuitee veya oteller ceza uygulayabilir, ilgili otelin fiyatlarına erişimi kapatabilir.
- İzleme: `rateParity.belowSuggestedPrice = true` olan siparişler finans ve satış raporunda ayrı gösterilecek (P15/P18).
- Geri dönüş: Politikada ayar `false` yapılıp onaylanır. Yeni aramalar hemen gizlemeye döner. Eski arama sonuçları, politika sürümü değiştiği için teklif aşamasında `QUOTE_CHANGED` ile düşer.
- Şartname §6'daki SSP kuralından bu ADR ile, işletme kararıyla ayrılınmıştır. T02 bu ayrımı test eder.
