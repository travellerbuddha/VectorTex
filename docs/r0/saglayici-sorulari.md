# Sağlayıcılara gönderilecek sorular (hazır metinler)

Bu sorular kanıtla kapatılamayan açık noktalardır (bkz. `R0-kanit-raporu.md` §9–§10). Yanıtlar geldiğinde `contracts/capability-matrix.json` kanıtlarına işlenir. Metinler doğrudan kopyalanıp gönderilebilir.

---

## 1. Nuitee (liteAPI) — account manager / support

**Subject:** TexHoliday – sandbox findings and account capability questions (hotels, flights, experiences)

Hello,

We are integrating Nuitee Connect (hotels, flights, experiences) into our own booking site. During sandbox testing on 9 October 2026 we found the following and need your confirmation:

1. **Commission when we collect the payment ourselves.** We sell hotels on our own payment gateway with the `margin` parameter set by us, and book with `ACC_CREDIT_CARD`. In sandbox (booking `M9KFYzg0w`, margin 10) the booking `price` was 1521.09 EUR and `commission` 138.27 EUR. Please confirm: (a) the account card is charged the full `price` including the commission; (b) the commission is paid out to us weekly after the guest checks out, as in your revenue guide; (c) which payout statement/reference we can use to reconcile each payout with our bookings (by `bookingId` or `clientReference`); (d) whether any commission is paid when a booking is cancelled with a penalty; (e) for a free cancellation, is the full amount including the commission refunded to the card (sandbox: yes)?
   Separately: `margin: 0` (net rate) offers were always refused at prebook with HTTP 409 / code 2001, while 0.5–12.5% and the account default worked. Is margin 0 restricted on our account or only in sandbox?
2. **Account credit card in production:** please confirm a production card can be attached to our account for `ACC_CREDIT_CARD` bookings, and any limits that apply.
3. **Credit line:** what is required to contract a credit line (`CREDIT`), and is there any way to test it before production?
4. **Flights:** can we book flights with `usePaymentSdk: false` and `ACC_CREDIT_CARD` (or `CREDIT`)? The prebook description requires "payment bypass" plus a credit line or whitelabel checkout. Please tell us how payment bypass is enabled for our account.
5. **Experiences access:** our key gets HTTP 403 / code 40301 ("Experiences API access is not enabled for this account") on `GET /experiences/tours`. Please enable Experiences for our account in sandbox and production.
6. **Experiences independent funding (most important for our launch):** the current Experiences contract accepts only `usePaymentSdk: true` and `TRANSACTION_ID` (Phase 1). We need to sell experiences inside packages paid once through our own payment gateway, with the supplier cost funded by account card or credit line. Is an independent funding option (e.g. `ACC_CREDIT_CARD` or `CREDIT`) planned, and when could it be enabled for our account?
7. **Experiences webhooks:** how are webhook calls authenticated (signature/header), and what is the retry policy?

Thank you,
TexHoliday

---

## 2. iyzico — entegrasyon@iyzico.com / müşteri temsilcisi

**Konu:** TexHoliday – ön provizyon (CheckoutForm) entegrasyonu ve webhook aktivasyonu

Merhaba,

Kendi sitemizde iyzico Ödeme Formu ile ön provizyon (pre-auth) alıp, tedarikçi rezervasyonları kesinleşince provizyon kapatma (postauth) yapacağız. Aşağıdaki konularda teyit ve aktivasyon rica ediyoruz:

1. Üye işyeri hesabımızda **ön provizyon** ve **TRY, EUR, USD, GBP** tahsilat/settlement açık mı? (Postauth yanıt dokümanında para birimi listesinde GBP yok; GBP ön provizyon kapatılabiliyor mu?)
2. **Kullanılmayan bir ön provizyon** (rezervasyon gerçekleşmezse) nasıl serbest bırakılmalı? Dokümanda iptalin "aynı gün" ve "kısmi tutar desteklenmez" olduğu yazıyor; ertesi gün iptal gerekirse ne yapmalıyız, yoksa 25 günlük süre dolunca otomatik mi kalkıyor?
3. CF sorgulama yanıtındaki **`phase`** alanının alabileceği değerler nelerdir (ör. PRE_AUTH / POST_AUTH / AUTH)?
4. **Webhook signature V3** özelliğinin hesabımızda aktifleştirilmesini rica ediyoruz (HPP/Ödeme Formu formatı).
5. **Yabancı müşteriler:** T.C. kimlik numarası olmayan müşterilerde `identityNumber` alanına pasaport numarası göndermemiz uygun mu? Sahte/sabit numara kullanmak istemiyoruz.
6. Sandbox API anahtarı ve secret key paylaşabilir misiniz?

Teşekkürler,
TexHoliday

---

## 3. Welcome Pickups — partnerships@welcomepickups.com

**Subject:** TexHoliday – API access (staging key, credit account) and integration questions

Hello,

We would like to integrate Welcome Pickups transfers into our booking site and packages through the external API.

1. Please provide a **staging API key** and tell us how to open a **credit account** (`payment_method: "credit"`).
2. Is `booking_reference` enforced as **unique** per partner? Does `GET /v1/external/transfers?booking_reference=…` return **exact matches only**? We use it to recover from a lost create response without booking twice.
3. The quote request is created at `/v1/external/quote-requests` but read at `/v1/external/quote_requests/{id}`. Are both spellings correct?
4. In which timezone are `pickup_date` / `pickup_time` interpreted (local time of the pickup location)?
5. How are webhooks authenticated, and do you retry failed deliveries?

Thank you,
TexHoliday
