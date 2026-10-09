---
updatedAt: 2026-08-12T19:22:49.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Flights — Support & Billing Model

How Nuitée services flight bookings, how airline changes reach your system, and how servicing costs settle.

Selling flights is the easy part. Servicing them is where the complexity lives. This page explains what Nuitée takes off your plate: how we support your travellers, how each support model works, and how billing stays simple and transparent.

## What we handle

Running flight servicing in-house means recruiting scarce GDS-trained specialists, staffing nights, weekends and holidays, absorbing high agent turnover, and keeping pace with airline rules that change weekly.

Nuitée provides a dedicated flight operations team of airline-servicing specialists, available 24/7, every day of the year. We hold the servicing policy for the world's largest full-service carriers and low-cost carriers alike — so you never have to build and maintain a per-airline policy library of your own.

| Area                             | What we cover                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Schedule changes & IRROPs        | Involuntary rebookings, proactively flagged before they become a problem for your traveller. |
| Cancellations, voids & refunds   | Including the void-window and airline refund rules that trip up in-house teams.              |
| Modifications & special requests | Booking changes, baggage additions and special requests across GDS, NDC and LCC content.     |
| Live airport emergencies         | Stranded passengers, check-in refusals and gate cancellations, with a direct hotline.        |

> **We execute, not just notify.** Nuitée modifies the booking directly. We do not hand you a list of options and a link to the airline's agency tool. Our specialists action the change themselves — rebooking, reissue, cancellation or refund — and you receive a settled booking, not a task.

## Two support models

You decide how close we sit to your traveller. Both models carry the same SLA and the same fees. The only difference is who your traveller talks to.

| Model           | Who the traveller talks to                          | Your servicing workload                                   |
| --------------- | --------------------------------------------------- | --------------------------------------------------------- |
| **First Line**  | Nuitée, directly. We answer, we fix, we confirm.    | None                                                      |
| **B2B-Relayed** | Your team. You relay cases to us by phone or email. | You stay the face of support; we do the airline-side work |

### First Line — flow

1. Traveller contacts Nuitée directly.
2. A Nuitée agent services the booking with the airline.
3. The traveller's card is charged — Nuitée is Merchant of Record.
4. Nothing lands on your team.

### B2B-Relayed — flow

1. Traveller contacts your team.
2. You relay the case to Nuitée by phone or email.
3. Nuitée services the booking behind the scenes.
4. The cost settles automatically on your credit line.

## How airline changes reach us — and reach you

Involuntary changes are pushed to us by the airline, per booking, as they happen. Our agents see the change at the same moment the traveller does.

Two things happen at once when an airline changes a flight:

* **To Nuitée, per booking.** A message lands against the specific booking reference / PNR, and our desk is alerted immediately.
* **To the traveller, by email.** Only if the traveller's own contact details are on the booking. Which contact goes into the booking is configurable at onboarding.

From there, one of two paths runs:

* **Path A — we act first.** Our agent assesses the disruption, builds the realistic options, and gets the traveller moving before they have to chase anyone.
* **Path B — the traveller acts first.** The traveller changes the flight with the airline themselves. The airline then sends us the updated booking data — new flight or cancellation — and we re-sync automatically.

Either way, Nuitée applies the change on our side: booking record, ticket status, and any reissue or refund are brought into line. You then receive the updated booking as a **webhook event**, mirrored to your operations inbox by **email**.

### Notification path by content type

| Content type      | How the airline reaches us                                                                                                                       | What that means in practice                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **GDS / EDIFACT** | Queue messages against the PNR: changed segment status, cancellations, and airline prompts requiring the ticket to be reissued by a stated date. | Fastest and richest signal. Reissue deadlines are visible to us, so nothing lapses. |
| **NDC**           | Order-change notifications from the airline's retailing platform, tied to the order reference.                                                   | Structured and near real-time; servicing options follow that airline's own rules.   |
| **LCC**           | Often no structured message — the airline emails the booking contact and updates its portal. We monitor and poll for the change.                 | Detection can lag the airline's own email to the traveller.                         |

### Who we contact

| Model           | Traveller outreach                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **First Line**  | We contact the traveller directly and proactively, present the options, and confirm the one they choose. You are kept informed throughout. |
| **B2B-Relayed** | We do not contact your traveller. We notify **you** with the change and the viable options; you relay the decision back and we execute it. |

**Three attempts, then we protect the traveller.** We make at least three contact attempts before departure. If there is still no decision, we accept the airline's protected itinerary on the traveller's behalf so they stay ticketed and can travel — and we tell you what we did.

**If the traveller changes it with the airline while we are working the case,** the airline's updated booking data wins. We re-sync the booking, close our case, and send you the update. No double booking, no double charge, and no service fee for work the traveller resolved themselves.

> **One honest limit: the airport control window.** Close to departure — typically the final 24 to 48 hours, and once check-in opens — the airline takes operational control of the booking. From that point some changes can only be made by the airline at the airport or on its own channels. Our emergency desk stays with the traveller throughout.

## Billing

Billing follows one rule: **we never charge you directly.** Servicing costs — fare difference, change fee and service fee — pass through the API and settle automatically against your credit line. Wherever a traveller's card is charged, Nuitée acts as Merchant of Record and absorbs the payment risk.

| Mechanism                  | What it means                                                                                                                                                                                                                              | How it shows up                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Stripe SDK integration** | Embed Nuitée's Stripe SDK in your product and your travellers pay by card at checkout, with Nuitée as Merchant of Record. You take payments without building payment infrastructure or carrying payment risk.                              | The traveller's card is charged under Nuitée's entity. You are never charged by card — servicing costs still settle via your credit line. |
| **Credit line**            | The default for all servicing. Costs pass through the API and settle automatically — no invoices to chase, no manual charging events.                                                                                                      | A transparent line item on your credit line statement, reconciled per booking reference.                                                  |
| **Merchant of Record**     | Whenever Nuitée charges a traveller's card, the transaction is processed under Nuitée's entity. Even when you are Merchant of Record for the original booking, Nuitée can still charge the traveller separately for the servicing amounts. | Cardholder statement descriptor reads the Nuitée entity name, regardless of support model.                                                |

> **Merchant of Record = risk transfer, not just processing.** We carry the payment processing, fraud screening, chargeback handling and refund execution — operational and financial liability you never have to build for.

## Fees

Airline costs are passed through at cost. Our only servicing charge is a flat, predictable fee per **voluntary** case; it does not apply to airline-caused involuntary changes.

| Fee component      | Amount                | Basis                                                                                                    |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| Fare difference    | Pass-through, at cost | Set by the airline at time of re-issue. Nuitée does not mark this up.                                    |
| Change fee         | Pass-through, at cost | Set by the airline's fare rules. Varies by carrier and fare class.                                       |
| Nuitée service fee | **USD $25 flat**      | Charged per *voluntary* servicing case, in either support model. Waived entirely on involuntary changes. |

## Who gets charged

| Support model   | Who Nuitée charges                                                                         | Traveller settlement                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **First Line**  | The traveller's card on file                                                               | Charge appears on the traveller's statement under Nuitée's Merchant of Record entity.                     |
| **B2B-Relayed** | No one is charged — servicing costs pass through the API to your credit line automatically | You settle with your traveller however fits your business. This step is outside Nuitée's SLA and control. |

Even when you are Merchant of Record for the original booking, Nuitée can charge your traveller directly and separately for the servicing amounts — keeping servicing revenue collection off your plate. Agreed at onboarding.

## Always on, always reachable

Our servicing desk operates Monday to Sunday, 24/7, with escalation channels matched to departure proximity. Full response and resolution commitments are set out in the Nuitée Flights Service Level Agreement.

| Situation                | Channel                                         |
| ------------------------ | ----------------------------------------------- |
| 2+ days from departure   | `flights@nuitee.com`                            |
| Same-day departure       | `priorityflights@nuitee.com`                    |
| Live airport emergencies | `flights.emergency@nuitee.com` + direct hotline |
| In-trip support          | `flights.inflight@nuitee.com`                   |