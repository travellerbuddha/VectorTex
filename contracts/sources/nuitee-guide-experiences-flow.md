---
updatedAt: 2026-10-07T13:20:38.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Build an Experiences Booking Flow

This guide walks you through building a complete Experiences booking flow — from search to confirmed booking and voucher.

## Booking flow overview

```text
Search → Detail → Availability → Booking options
  → Prebook → Pay (Stripe) → Book → Confirm
```

Each step depends on the previous one. You cannot book without a prebook. You cannot prebook without a priced selection from booking-options. Design your frontend accordingly.

**Base URL**

* All Experiences endpoints (discovery and checkout): `https://api.liteapi.travel/v3.0`

**Auth:** `X-API-Key` with Experiences access enabled.<br />**Payment:** Stripe via `TRANSACTION_ID` (`usePaymentSdk: true`).

***

## 1. Search

**What happens:** You request tours for a destination (or filters) with `language` and `currency`. Connect returns tour cards you can render in a list or map.

**Why it matters:** Keep `language` and `currency` consistent for the whole session. Mixing currencies mid-flow causes price mismatches at prebook.

**Best practices:**

* Always send `language` and `currency`
* Store `tourId` from the result you want to open
* Prefer re-search over caching results across long sessions

**Common mistake:** Starting checkout with a tour from a different currency session than the one used at booking-options / prebook.

***

## 2. Detail (and optional reviews)

**What happens:** You load full tour content (description, media, practical info) and optionally reviews.

**Why it matters:** Guests decide before they pick a date. Show inclusions, meeting points, and cancellation policy clearly.

**Best practices:**

* Load reviews lazily if they are not on the critical path
* Keep the same `tourId`, `language`, and `currency` into availability

***

## 3. Availability

**What happens:** You retrieve available dates and participant categories (`ticketCategory` such as `adult`, `child`).

**Why it matters:** Participant keys from availability are the stable identifiers for booking-options and prebook. Do not invent your own category IDs.

**Best practices:**

* Drive the date picker from `availableDates`
* Use `ticketCategory` values exactly as returned
* Respect participant min/max hints when present

**Common mistake:** Sending provider-specific category IDs instead of semantic `ticketCategory` keys.

***

## 4. Booking options

**What happens:** For a chosen date and participant mix, Connect returns options, time slots, live prices, and `bookingQuestionSchema`.

**Why it matters:** This is the price and slot you will charge. The total you show here must match prebook.

**Best practices:**

* Take `optionId`, `dateTime`, and `pricing.totals.net` (or `priceSummary.netPrice`) from the **chosen slot**
* Collect answers for every required field in `bookingQuestionSchema`
* Re-call booking-options when date, option, or participants change

**Common mistake:** Using `options[].price.amount` (lowest available slot) instead of the selected slot’s `totals.net`.

See [Experiences Pricing](https://docs.liteapi.travel/docs/experiences-pricing) for field details.

***

## 5. Prebook (checkout hold)

**What happens:** You send the selection and `usePaymentSdk: true`. Connect creates a temporary hold and a Stripe PaymentIntent, returning `prebookId`, `transactionId`, and `secretKey`.

**Why it matters:** Inventory is held here (typically \~10 minutes). Abandoned prebooks expire.

**Best practices:**

* Set `selection.price.amount` to the booking-options slot total
* Store `prebookId`, `transactionId`, and `secretKey` immediately
* Surface error **2015** as “price changed — refresh options” and re-run booking-options

**Common mistake:** Calling prebook with a stale price after the guest changed participants.

***

## 6. Pay & book

**What happens:** The client confirms Stripe with `secretKey`. Your backend then calls book with `prebookId` and `payment.method: TRANSACTION_ID`.

**Why it matters:** Do not call book until Stripe succeeds. Book often returns `PENDING_CONFIRMATION`, not final confirmation.

**Best practices:**

* Confirm Stripe first, then book
* Show a “confirming your booking” state after book
* Poll GET booking and/or listen for webhooks until `CONFIRMED`

**Common mistake:** Treating HTTP 200 on book as “voucher ready.” Wait for `CONFIRMED` / voucher events.

See [Async Confirmation & Webhooks](https://docs.liteapi.travel/docs/experiences-async-confirmation-webhooks).

***

## 7. Confirmation

**What happens:** When status is `CONFIRMED`, voucher details may appear on GET booking (and via webhook).

**Best practices:**

* Display booking id and voucher reference prominently
* Email the guest as soon as confirmation / voucher is available
* Store Connect `bookingId` in your database for support and cancel

***

## Critical concepts

### Price consistency

The amount on booking-options must equal prebook `selection.price.amount`. A mismatch returns **2015**. Refresh options; do not invent a total.

### Async confirmation

Book acceptance is not always final confirmation. Design for `PENDING_CONFIRMATION` → `CONFIRMED`.

### Hold window

Prebooks expire. Move guests through Stripe quickly; if the hold expires, restart from booking-options.

### Payment lifecycle

Prebook creates the PaymentIntent. The client confirms Stripe. Book captures and finalizes. Never reverse that order.

***

## Recommended UX flow

1. Guest searches experiences and opens a tour
2. Guest picks date and participants → call availability / booking-options
3. Guest selects option + time slot → show price and required questions
4. Guest enters contact details → prebook
5. Guest pays with Stripe
6. Call book → show “confirming…”
7. On `CONFIRMED`, show voucher / confirmation and send email

***

## Common mistakes

**Skipping booking-options.** You need a live slot total and schema before prebook.

**Wrong price on prebook.** Always use the chosen slot `totals.net`.

**Booking before Stripe confirms.** Confirm payment first.

**Ignoring&#x20;**`PENDING_CONFIRMATION`**.** Poll or use webhooks before promising a voucher.

**Changing currency mid-flow.** Keep one currency for the session.

***

## Next

* [Booking Flow Recipes](https://docs.liteapi.travel/docs/experiences-booking-flow-recipes)
* [Experiences Booking Architecture](https://docs.liteapi.travel/docs/experiences-booking-architecture)
* [Experiences Pricing](https://docs.liteapi.travel/docs/experiences-pricing)
* [API Reference](https://docs.liteapi.travel/docs/experiences-reference)

<br />