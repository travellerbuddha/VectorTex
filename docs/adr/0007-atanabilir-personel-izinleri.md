# ADR-0007 — Atanabilir personel izinleri ve politika onayı

- Durum: Kabul edildi (2026-10-09). İşletme kararı: "Onay kuralı: izinler kısmından kullanıcılara bu izin atanabilmeli."
- İlgili: şartname §16 (roller, rol/kayıt kapsamı), §17 (denetim izi), G06; ADR-0003 (finans çekirdeği CMS'den ayrı).

## Bağlam

Fiyat ve risk politikaları yalnız `FINANCE_APPROVER` rolüyle ve iki kişili onayla (değişikliği yapan onaylayamaz) aktifleşiyordu. Roller koda gömülüydü. İşletme, bu yetkinin yönetimdeki "İzinler" bölümünden kullanıcılara atanmasını istedi.

## Karar

1. **Yetki birimi izindir.** Personele izinler tek tek verilir ve geri alınır. Katalog `packages/contracts/src/permissions.ts` dosyasındadır; migration aynı listeyi `core.permissions` tablosuna yazar (test ile eşitliği denetlenir). İzinlerin Türkçe ve İngilizce açıklaması ekranda gösterilir.

   | İzin | Anlamı |
   |---|---|
   | `permissions.manage` | Kullanıcılara izin verir ve geri alır |
   | `pricing_policy.edit` / `risk_policy.edit` | Politika taslağı oluşturur ve düzenler |
   | `pricing_policy.approve` / `risk_policy.approve` | Başkasının hazırladığı politikayı onaylar veya devreden çıkarır |
   | `pricing_policy.approve_own` / `risk_policy.approve_own` | Kendi hazırladığı politikayı tek başına onaylar |

2. **Roller hazır paketlerdir.** Şartnamedeki roller (Owner/Admin, Finance, FinanceApprover, …) atanınca içindeki izinler tek tek verilir. Gerçek kaynak her zaman izin listesidir. Kendi değişikliğini onaylama (`*.approve_own`) hiçbir pakette yoktur; bir kişiye ayrıca ve bilerek verilir.

   | Rol paketi | Verdiği izinler |
   |---|---|
   | Owner/Admin | `permissions.manage`, `pricing_policy.edit`, `risk_policy.edit` |
   | Finance | `pricing_policy.edit`, `risk_policy.edit` |
   | FinanceApprover | `pricing_policy.approve`, `risk_policy.approve` |
   | ContentEditor, Operations, Viewer | Henüz izin yok; kapsadıkları özelliklerle birlikte gelir (P06, P15) |

3. **Onay kuralı:**

   | Durum | Gereken izin | Kayıt (`approval_mode`) |
   |---|---|---|
   | Başkasının taslağını onaylama | `<tür>.approve` | `FOUR_EYES` |
   | Kendi taslağını onaylama (hazırlayan veya son düzenleyen) | `<tür>.approve_own` | `SELF` |

   - `approve_own` kimseye verilmezse iki kişili onay aynen sürer.
   - Mod, onaylanan sürüme ve denetim kaydına yazılır.
   - İzin geri alındığı anda geçersiz olur.
4. **Yetki çağırandan alınmaz.** `StaffActor` yalnız kimlik taşır (giriş: ADR-0010, `core.staff_users`). Repository'ler kişinin aktif izinlerini `core.staff_permission_grants` tablosundan okur.
5. **Veritabanı aynı kuralları uygular** (uygulama atlansa bile):
   - İzin verme ve geri alma yalnız `permissions.manage` sahibi tarafından yapılabilir.
   - İzin kayıtları silinmez; geri alma bir kez, kimin ve ne zaman yaptığıyla kaydedilir.
   - Son `permissions.manage` sahibinin izni geri alınamaz (kilitlenme önlemi).
   - Politika taslağını düzenleyen `<tür>.edit` iznine sahip olmalıdır.
   - Onayda moda göre `approve` ya da `approve_own` izni aranır. `FOUR_EYES` onayında onaylayan kişi hazırlayan veya son düzenleyen olamaz (CHECK).
6. **İlk kurulum:** İlk yönetici bir kez atanır: `DATABASE_URL=... pnpm --filter @texholiday/db permissions:bootstrap <personelId>`. Bu komut yalnız hiç `permissions.manage` sahibi yokken çalışır; sonrasında izinler ekrandan verilir.

## Sonuçlar

- `permissions.manage` sahibi kendine de izin verebilir, `approve_own` dahil. Bu işletmenin tercihidir ve her işlem denetim kaydına yazılır. Bu yetki az kişiye verilmelidir.
- "İzinler" ekranı `/yonetim` içinde Payload/Next uygulamasıyla gelecek (P05/P06). Arka uç (`PermissionRepository`: katalog, kişi izinleri, geçmiş, izin verme, rol paketi, geri alma, ilk kurulum) hazırdır.
- Yeni özellikler kendi izinleriyle gelir: katalog, migration ve rol paketi güncellenir. Örnek: iptal/iade komutları P15.
