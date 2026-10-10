---
updatedAt: 2026-10-08T13:33:28.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Booking Flow Recipes

Practical recipes for common Experiences integrations. Use these alongside [Build an Experiences Booking Experience](https://docs.liteapi.travel/docs/build-an-experiences-booking-flow).

***

## Recipe 1: Basic booking flow

**When to use:** MVPs, internal tools, and B2B platforms where a simple linear checkout is enough — no multi-step wizard, no saved carts, just search to confirmed booking in one pass.

### Flow

```text
Search → Detail → Availability → Booking options → Prebook → Stripe → Book → Poll / webhook
```

### Step-by-step

1. **Search for tours**

Start with a plain search to get a list of tours the guest can pick from.

```http
GET /v3.0/experiences/tours?language=en&currency=EUR
```

Save the `tourId` of whichever tour the guest opens next.

2. **Check availability and price the booking**

Once the guest picks a date and participant count, pull availability and the priced booking options together — you need both before you can let them check out.

```http
GET /v3.0/experiences/tours/{id}/availability?language=en
POST /v3.0/experiences/tours/{id}/booking-options
```

Hang on to `optionId`, `dateTime`, the chosen slot's `pricing.totals.net`, and the guest's answers to any required booking questions — you'll need all four at the next step.

3. **Create a prebook**

This is where inventory actually gets held and a Stripe PaymentIntent gets created.

```http
POST /v3.0/experiences/tours/{id}/prebooks
```

Send `usePaymentSdk: true` and set `selection.price.amount` to the slot total from step 2. Store `prebookId`, `transactionId`, and `secretKey` as soon as they come back — the hold is time-limited.

4. **Let the guest pay**

On the client, confirm the Stripe payment using the `secretKey` from the prebook.

5. **Book**

Once Stripe confirms, call book with `payment.method: TRANSACTION_ID`. Don't be surprised if the response comes back `PENDING_CONFIRMATION` rather than fully confirmed — that's expected.

```http
POST /v3.0/experiences/bookings
```

6. **Wait for confirmation**

Poll `GET /experiences/bookings/{bookingId}` or listen for a webhook until `status` reaches `CONFIRMED`.

### Key decisions

* `usePaymentSdk: true` is the right default here — this flow assumes Stripe.
* Keep one `language`/`currency` for the whole session; switching mid-flow causes price mismatches.
* If prebook returns **2015**, refresh booking-options and use the new total — don't retry with the old one.

### Pitfalls

* Using the lowest option price instead of the price on the **slot the guest actually picked**.
* Calling book before Stripe has actually confirmed the payment.
* Showing the guest a voucher as soon as book returns 200 — wait for `CONFIRMED`.

***

## Recipe 2: Consumer checkout with clear confirmation states

**When to use:** Consumer-facing sites where trust and conversion matter — the guest needs to feel confident at every step, not just get a fast checkout.

### Flow

```text
Search → Tour page → Date & participants → Options/slots
  → Questions + contact → Prebook → Stripe → Book
  → "Confirming…" → Confirmed + voucher email
```

### Step-by-step highlights

1. **Price as soon as you can.** Call booking-options the moment the guest has a valid date and participant count, so they see a real price before committing further.
2. **Keep that price visible.** Show the slot price prominently and lock it into the order summary so it doesn't shift under them.
3. **Collect questions before prebook.** Get the guest's answers to the required `bookingQuestionSchema` fields before you call prebook — not after.
4. **Don't imply the ticket is ready.** After book, show a dedicated "confirming" screen; the booking usually isn't finalized yet.
5. **Wait for the real signal.** Move to the success screen only when status is `CONFIRMED` or the voucher webhook arrives — not on book's initial response.

### Key decisions

* Prefer partner webhooks for confirmation, and poll only as a backup — webhooks get you to "ticket ready" faster and more reliably.
* Email the guest when `CONFIRMED` or the voucher is available, not just because book returned HTTP 200 — that response doesn't mean the booking is final.

### Pitfalls

* Auto-closing checkout on book 200 while the booking is still `PENDING_CONFIRMATION` — the guest hasn't actually been confirmed yet.
* Losing the `bookingId` from the book response — you'll need it to poll status or help the guest later.

***

## Recipe 3: Handling price mismatch (2015)

**When to use:** Any time prebook returns error **2015**, or the guest changes their selection after already seeing a price.

### Detection

A `2015` means the price you sent no longer matches what booking-options would return now — usually because time passed or the guest changed something.

```javascript
const res = await prebook(selection);
if (res.error?.code === 2015) {
  const refreshed = await bookingOptions({ date, participants });
  showPriceRefresh({ previous: selection.price.amount, options: refreshed });
}
```

### UX recommendations

Tell the guest plainly that the price or availability changed — don't let it look like a bug. Show the new slot total clearly, then give them one primary action ("Continue with new price") and a secondary way out ("Pick another time").

### What not to do

Don't silently retry prebook with the old amount — it'll just fail again. And don't force the guest back to a full search restart if only the price changed; refreshing booking-options is enough.

***

## Recipe 4: Payment handling

**When to use:** Every Stripe checkout — this is the sequence that has to happen in order, every time.

### Standard flow

The three steps have to happen in this exact order, because each one produces something the next one needs:

1. Prebook with `usePaymentSdk: true` to get back `transactionId` and `secretKey`.
2. On the client, call `stripe.confirmCardPayment(secretKey, …)`.
3. Only once that succeeds, call `POST /experiences/bookings` with that same `transactionId`.

### Retry notes

If Stripe fails, don't call book at all — there's nothing to confirm yet. If book returns **502** after a successful Stripe confirm, show a failure/support state rather than telling the guest the experience is booked; if you're genuinely unsure whether book succeeded, it's safe to poll GET booking to check.

### Pitfalls

* Booking with a `transactionId` that came from a different prebook than the one you're confirming.
* Reusing a prebook after its hold window has already expired.

***

## Recipe 5: Cancel flow

**When to use:** Manage-booking or support tools — anywhere a guest or agent might cancel an existing booking.

### Flow

Always show the guest what they'll get back before they commit to cancelling:

```text
Cancel preview → Show refund quote → Cancel → Wait for CANCELLED (poll / webhook)
```

```http
GET  /v3.0/experiences/bookings/{bookingId}/cancel-preview
POST /v3.0/experiences/bookings/{bookingId}/cancel
```

### Key decisions

Always call cancel-preview before cancel in guest-facing UI — never let them cancel blind. And treat `CANCELLATION_REQUESTED` as "the request was accepted," not "the refund has landed" — that part may still be pending.

### Pitfalls

* Treating cancel's 200 response as "refund already in the bank."
* Skipping preview and surprising guests with a cancellation fee they didn't expect.

***

## Next

* [Experiences Booking Architecture](https://docs.liteapi.travel/docs/experiences-booking-architecture)
* [Async Confirmation & Webhooks](https://docs.liteapi.travel/docs/experiences-async-confirmation-webhooks)
* [Cancel & Refunds](https://docs.liteapi.travel/docs/experiences-cancel-refunds)

<br />