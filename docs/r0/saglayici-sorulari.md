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
8. **Payment SDK – retrying `TRANSACTION_ID` bookings.** In sandbox, a book call made before the customer finished paying returned 2014 "payment not completed", and that `clientReference` was then used up: after the payment, the same reference returned 4005 (duplicate) while `GET /bookings?clientReference=` found no booking. A new reference booked fine, and a third reference with the same (already used) `transactionId` returned 2014 again. We now send a new `clientReference` after every 2014 and rely on the transaction being single-use. Please confirm this is the intended behaviour and that one `transactionId` can never produce two bookings, also under concurrent requests.
9. **Payment SDK – language and payment methods.** (a) The component's button says "Pay" on our Turkish pages. The SDK source has a `submitButton.text` option that the user-payment guide does not document: is it supported, and can the Stripe form be shown in Turkish? (b) In USD the form offered Cash App Pay, Afterpay, Affirm, Amazon Pay and Klarna next to cards. Which methods are enabled per currency, and can we limit them? (c) Apple Pay reports an unregistered domain: how do we register our domain for Apple Pay?
10. **Payment SDK – refunds and suggested selling price.** (a) When a booking paid through the SDK is cancelled within its free cancellation period, is the customer refunded automatically to the same card, and when? In sandbox (booking `lobIb_dn4`) `PUT /bookings/{id}` answered `CANCELLED`, `cancellation_fee` 0 and `refund_amount` 173.36 EUR, the full amount the customer paid: is `refund_amount` the amount returned to the customer's card for SDK payments, and is there an API or webhook to confirm the refund? (b) In sandbox every offer's `suggestedSellingPrice` was above our price whatever the margin (net × 1.163 up to a 16% margin, price × (1 + margin) from 20%). Is sandbox SSP synthetic? In production, is SSP the hotel's own minimum public price per rate?
11. **Flights – booking before payment.** In sandbox, `POST /flights/bookings` with `TRANSACTION_ID` sent *before* the traveller paid in the payment component was accepted (HTTP 201, `PENDING_CONFIRMATION`, `paymentStatus` "succeeded") and became `CONFIRMED` with an airline PNR about three minutes later (in one run it was even ticketed). The flight guide says such a call "will fail provider-side". Please confirm that production refuses it, with which HTTP status and error code, and that no booking or ticket can exist for a `transactionId` whose payment intent was not confirmed. Is there a sandbox setting that reproduces the production check?
12. **Flights – amounts.** For the same sandbox booking the prebook `price` and `pricing.totalAmount` were 22.76 EUR, while `payment.amount` was 22.10 EUR ("Amount captured for payment") and `order.price` 23.30 USD. Which amount is charged to the traveller's card (we assume the prebook `price`, the amount of the payment intent), and what is `payment.amount`?
13. **Flights – payment status values.** The create response returned `paymentStatus` "succeeded"; `GET /flights/bookings/{id}` then returned "completed". The documented values are pending, completed, failed, not_required. Please list every value and its meaning.
14. **Flights – refunds of payment-component bookings.** Cancelling a component-paid sandbox booking answered `CANCELLED`, `cancellation_fee` 0, `refund_amount` 22.76 EUR, `destination` "agency_deposit" and an undocumented `refund_type` "full". The traveller paid by card with Nuitée as Merchant of Record. Who refunds the traveller's card, to which amount and when? Does "agency_deposit" mean the money is credited to our account instead of the card? Is there an API field or webhook that confirms the card refund?
15. **Flights – cancellation quote in sandbox.** `GET /flights/bookings/{id}/cancellations` answered HTTP 500 (59099, "failed to retrieve cancellation quote") for both confirmed and cancelled sandbox bookings. Is the quote available in sandbox, and for which carriers in production?
16. **Flights – ticketing evidence.** Some confirmed sandbox bookings had an airline PNR but no `ticketData`; another was ticketed about three minutes after booking, with `ticketData.ticketedAt` and an undocumented `ticketData.tickets[]` (ticket number, status "issued", passenger document fields), while `order.status` stayed "created". Please confirm that `ticketData.ticketedAt` is the authoritative signal that tickets are issued, that `ticketData.tickets[].ticketNumber` is the airline e-ticket number in production (in sandbox it equals the PNR), and whether a webhook announces ticketing. What happens if ticketing fails after the traveller paid (who refunds, and how are we told)?
17. **Flights – abandoned prebooks.** The guide says a prebook creates the provider reservation and that abandoned prebooks "may incur costs depending on your provider agreement". There is no endpoint to release a prebook. When does the hold expire, does an abandoned prebook cost us anything, and can we release one?
18. **Flights – markups and commission.** We send `margin.rateSearch` from our pricing policy. Which defaults does our account apply to `margin.seats`, `margin.bags` and `margin.penalties`, and who receives the markup on penalties? `distributorCommission` / `distributorPrice` were never returned in sandbox and have no currency: when are they present, in which currency, and how is our flight markup paid out when Nuitée is Merchant of Record?
19. **Flights – support model.** The support & billing guide offers First Line and B2B-Relayed. Does B2B-Relayed require a credit line on our account, and can First Line be used without one? Which contact (ours or the traveller's) should we put on the booking for each model?
20. **Flights – First Line onboarding.** We have chosen **First Line**. We put the traveller's own e-mail and phone in the prebook `contact`. Please confirm that this is the contact your desk and the airlines use for First Line, and configure our account accordingly. Which traveller-facing support channel (phone, e-mail, hours, languages) should our confirmations show? Is the USD 25 voluntary-servicing fee charged to the card used in the payment component, and is the traveller told the amount before it is charged?
21. **Flights – margin editing in production.** `margin.rateSearch` is "only honoured when flight margin editing is enabled for your account". In sandbox it was honoured: with `rateSearch` 10, `total` was (base + taxes + fees) × 1.0999–1.1000 on all 132 offers of a search (2026-10-10). Please confirm that flight margin editing is enabled on our production account. Our system refuses to sell an offer whose markup does not match our approved rate.
22. **Flights – seats and bags (attach services).** In sandbox (prebook `01a125af-c7d4…`, 2026-10-10) attaching a seat before booking returned a new `transactionId`/`secretKey` and an amount of exactly fare + seat price, and the paid booking cost that amount. Please confirm: (a) after attaching, the previous payment intent can no longer be paid (cancelled at Stripe?), and what happens if a traveller paid it anyway; (b) `bookedServices` showed `status: "pending"` and `phase: "post_booking"` for a seat attached before booking: when does the airline confirm a seat or bag, how are we told, and if it is refused after payment who refunds the service amount and how; (c) `servicesAttachable.notSupported` and `providerErrors` (e.g. `CARRIER_NOT_SUPPORTED`) and the missing group `available` flag are undocumented: may we rely on them; (d) the POST answer did not list the attached services (GET did): is that intended; (e) are `margin.seats` / `margin.bags` applied to `pricing.display.amount` of each service, and can the markup amount be read back? In the IST-AYT and IST-LHR sandbox offers no baggage was offered: which test route offers bags?

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
