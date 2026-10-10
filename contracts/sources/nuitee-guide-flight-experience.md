---
updatedAt: 2026-06-18T14:30:39.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Build a Flight Booking Experience

Nuitee Connect aggregates real-time flight inventory from GDS, NDC, and LCC providers into a single API.

This guide walks you through building a complete booking flow — from search to confirmed ticket.

## Booking Flow Overview

```
Search → Select → Verify → Prebook → (Add Extras) → Book → Confirm
```

Each step is a hard dependency on the previous. You cannot book without a prebook. You cannot prebook without a verified offer. Design your frontend accordingly.

***

## 1. Search

**What happens:** You send a `legs` array with origin, destination, and date. The API fans out to multiple providers and returns journeys — each with one or more offers — streamed or returned in a single response.

**Why it matters:** Results are live. Prices change between search and booking. Never cache and reuse search results across sessions.

**Best practices:**

* Use SSE streaming (`Accept: text/event-stream`) for a responsive UI — results arrive incrementally per provider batch.
* Always include `currency` and `country` (point of sale) to get accurate pricing for your market.
* Store the full `offerId` from each offer — it's msgpack-encoded and required verbatim in all downstream steps.

**Common mistake:** Sending `origin`, `destination`, or `departureDate` at the top level. These fields are not supported. Everything goes inside the `legs` array.

***

## 2. Select

**What happens:** The user picks a journey. You have the `offerId`, pricing, baggage hints, and fare conditions in the search response.

**Why it matters:** This is the last point where the user sees an unverified price. The price shown here may not be the price at booking.

**Best practices:**

* Show `expiration` on each offer if available — expired offers will fail at verify.
* Display baggage policy (`baggage.included`) prominently. Surprises at checkout kill conversions.
* Surface `isCheapest` as a UI badge — it requires no extra work and anchors user decisions.

***

## 3. Verify

**What happens:** You send the `offerId` to confirm the offer is still available and get a guaranteed price snapshot. The response includes updated baggage, fare rules, and a `changes` block if anything has shifted since search.

**Why it matters:** This is your price guarantee moment. If you skip verify and go straight to prebook, you risk charging users a stale price — or a prebook rejection from the provider.

**Best practices:**

* Always verify immediately before showing the booking summary page. Don't verify on select.
* If `changes` is present, surface the delta clearly. Show old price crossed out, new price highlighted. Users who understand a price change convert better than users who feel deceived at confirmation.
* A `404` here means the offer has expired. Return the user to search results and trigger a re-search.

**Common mistake:** Verifying once on page load and then waiting while the user fills in passenger details. Offers expire in minutes. Verify, then prompt for details quickly, or re-verify before prebook.

***

## 4. Checkout (Prebook)

**What happens:** You send the verified `offerId`, passenger details, and contact info. The API reserves the offer with the provider, creates a Stripe payment intent, and returns a `prebookId`, `transactionId`, and `secretKey`.

**Why it matters:** This is when the seat is held. The provider reservation is created here, not at booking. Abandoned prebooks tie up inventory.

**Best practices:**

* Collect all passenger fields — `birthday`, `document`, `name` — before calling prebook. A failed prebook due to missing passenger data wastes the user's time and your provider quota.
* Pass `usePaymentSdk: true` for standard Stripe integration. Only use `false` if your account has an enabled credit line with payment bypass — the API will reject the request otherwise.
* Store `prebookId` and `transactionId` in your session immediately. You need both for the next steps.

**Common mistake:** Using the wrong `transactionId` at booking. If you attach services after prebook, the services endpoint returns a **new** `transactionId`. Use that one — not the original from prebook.

***

## 5. Add Extras (Optional)

**What happens:** The prebook response includes `servicesAttachable` — a structured list of available seats and baggage options per segment. You can attach selections via a follow-up request to the prebook.

**Why it matters:** Ancillary attach rates of 20–40% are achievable with a well-placed seat selection step. This is meaningful incremental revenue on every booking.

**Best practices:**

* Present seat selection on a dedicated step between prebook and payment — not after. Users who have already "decided to buy" are most receptive.
* Use the seat map data to render a visual picker. A text list of seat codes converts poorly.
* The attach endpoint returns a new `transactionId` and `secretKey` reflecting the updated total. Confirm Stripe with the new secret, not the prebook secret.

***

## 6. Pay & Book

**What happens:** You confirm payment on the client side using the Stripe SDK and the `secretKey` from prebook (or attach-services). Then you call the bookings endpoint with the `prebookId` and `transactionId`. The API finalizes the reservation with the provider and returns a confirmed `bookingId` and `bookingRef`.

**Why it matters:** This endpoint is idempotent — if you call it twice with the same `prebookId`, you get the existing booking back. This matters for retry logic.

**Best practices:**

* Confirm Stripe payment before calling `/bookings`. The API does not charge the card — Stripe does. Calling `/bookings` without a confirmed payment intent will fail provider-side.
* Implement a client-side retry on network failure. The idempotency guarantee means double-booking is not a risk.
* Handle `409 Conflict` explicitly — it signals the prebook is in a state that can't be booked (already ticketed, duplicate, or invalid). Show a clear message and offer support contact.

***

## 7. Confirmation

**What happens:** You receive a `bookingId`, provider `bookingRef`, full passenger manifest, and itinerary. Use the GET booking endpoint to retrieve and display this at any time.

**Why it matters:** The `bookingRef` is the airline confirmation code. Passengers need this for check-in. It must be displayed and emailed immediately.

**Best practices:**

* Send a confirmation email immediately with `bookingRef`, full itinerary, and baggage summary.
* Store the `bookingId` in your database keyed to the user and transaction. You'll need it for future retrievals and customer support.
* Poll the GET endpoint if your booking is in a non-`CONFIRMED` status — some providers asynchronously update status after initial confirmation.

***

## Critical Concepts

### Price Changes

Prices can shift between search, verify, and prebook. The `changes` block in the verify response is your signal. Build UI that handles this gracefully — a price change is not an error, it's a normal market event.

### Offer Expiration

`offerId` values expire. The `expiration` field in verify tells you how long you have. Design your checkout to move fast: verify → prebook should happen within the expiration window. If you get a `404` at prebook, the offer is gone — send the user back to search.

### Payment Lifecycle

The payment lifecycle spans three calls. Prebook creates the intent. Attach-services (if used) creates a new intent superseding the first. Booking confirms the charge. Always use the most recent `transactionId` and `secretKey`. Using a stale one will result in a payment mismatch.

### Ancillaries as Revenue

Seats and bags are not a UX nicety — they're a revenue layer. The prebook response tells you exactly what's attachable. Skipping the extras step is leaving margin on the table. Build it properly once and it pays continuously.

***

## Recommended UX Flow

1. User enters origin, destination, dates, and passenger count.
2. Display streaming results as they arrive — show a loading state per provider batch.
3. User selects a journey. Show fare rules and baggage before they confirm.
4. Call verify. Show updated price if `changes` is present — require explicit re-confirmation.
5. Display booking summary with passenger form. User fills in details.
6. Call prebook. On success, show the seat selection step using `servicesAttachable`.
7. User selects seats or skips. Call attach-services if selections were made.
8. Show payment form using the current `secretKey` with the Stripe SDK.
9. On Stripe confirmation, call `/bookings`. Redirect to confirmation page.
10. Display `bookingRef` prominently. Send confirmation email.

***

## Common Mistakes

**Skipping verify.** The search price is indicative. The verify price is what you can charge. If you skip it, you'll oversell or underprice — both are bad.

**Using the wrong `transactionId`.** After attach-services, the original prebook `transactionId` is stale. This is the most common cause of payment failures in production.

**Not handling offer expiration.** Offers expire in minutes, sometimes seconds. A user who lingers on the checkout page will hit a stale offer. Build re-verify or re-search fallbacks.

**Treating prebook as reversible.** A prebook creates a provider reservation. Abandoned prebooks waste inventory and may incur costs depending on your provider agreement. Complete or cancel promptly.

**Showing raw fare basis codes.** `fareBasisCode` and `bookingCode` are internal codes. Show `fareFamily` and cabin class names instead. Exposing `Y` or `WQNREF` to consumers destroys trust.

**Building seat selection after payment.** Seat selection converts best when presented before the user has committed to final payment. Post-payment upsell rates are significantly lower.