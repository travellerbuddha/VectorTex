---
updatedAt: 2026-09-11T18:37:45.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Hotel Integration Guide

This guide covers the recommended architecture and workflow for building a hotel booking experience 

The recommended booking flow is:

Search → Rate Results → Hotel & Room Selection → Prebook → Payment → Book → Confirmation

Before implementing this flow, you should first decide how your application will discover properties and manage hotel content.

⸻

## Property Discovery and Hotel Content

Property discovery is not part of the booking transaction itself. It determines how your application knows which hotels exist, how travelers discover them, and which properties should be included when a traveler searches a destination.

There are two primary approaches.

### Option A: Location-Based Discovery

For many integrations, the simplest approach is to use geographic information to determine which properties should be searched.

For example, your application might use:

* Google Places
* Latitude and longitude
* Your own destination or geographic database

A traveler might search for:

> New York City

Your application resolves that destination to a geographic area and uses that information to identify the relevant hotels for the liteAPI rate search.

This approach avoids the need to maintain the entire liteAPI hotel dataset locally.

### Option B: Maintain Hotel Content Locally

If you’re building a more complete OTA experience, you may want to maintain liteAPI’s static hotel content in your own database.

This can be useful for:

* Destination pages
* Hotel landing pages
* SEO
* Property search and autocomplete
* Geographic filtering
* Amenity filtering
* Hotel descriptions
* Images
* Room information
* Other property discovery experiences

#### Use Your Whitelabel as a Reference

Your liteAPI Whitelabel is a useful reference when designing your own hotel experience.

It demonstrates the types of hotel content available through liteAPI and how that content can be presented throughout the traveler journey.

You do not need to reproduce the Whitelabel interface. Instead, use it as a working example of the content available to you and how static hotel content can be combined with live rates and availability.

⸻

## 2. Maintaining the Static Hotel Dataset

If you choose to maintain liteAPI hotel content locally, the recommended synchronization workflow is:

### Fetch the List of Countries

Use the Countries endpoint to retrieve the list of available countries:

`GET /data/countries`

### Fetch Hotels for Each Country

For each country, retrieve and store its hotels using:

`GET /data/hotels`

You will need to paginate through the results to retrieve all applicable properties.

### Fetch Full Hotel Details

For complete property information, including room content, use Hotel Details:

`GET /data/hotel`

You do not necessarily need to retrieve full Hotel Details for every property during your initial synchronization.

For example, you might maintain the general hotel dataset locally and request Hotel Details on demand when a traveler opens a specific hotel and needs richer content or room information.

### Keeping Your Dataset Updated

After completing the initial synchronization, use lastUpdatedAt to retrieve properties that have changed since your previous synchronization.

For example:

`GET /data/hotels?lastUpdatedAt=YYYY-MM-DDTHH:mm:ssZ`

Provide the most recent applicable timestamp from the properties stored in your database.

This allows you to process incremental changes rather than repeatedly retrieving the complete dataset.

> **Important**: Static-data endpoints have stricter rate limits. Large synchronization jobs must be throttled and distributed over time. Do not attempt to retrieve the entire multi-million-property dataset in a single day.

Static hotel content can be maintained locally, but rates and availability should always be treated as live data.

⸻

## 3. Building the Search Experience

Once you’ve determined how properties will be discovered, you can build the transactional hotel shopping experience.

A typical traveler journey begins with a search containing information such as:

* Destination
* Check-in date
* Check-out date
* Number of rooms
* Number of guests
* Guest ages, where applicable

That search leads into the live rate-shopping process:

Search<br />↓<br />Rate Results<br />↓<br />Hotel Selected<br />↓<br />Rooms & Rates<br />↓<br />Prebook<br />↓<br />Payment (Intent)<br />↓<br />Book<br />↓<br />Confirmation

There are two important types of rate searches in this flow:

1. A **broad rate search** used to build the hotel results page.
2. A **detailed hotel rate** search used after the traveler selects an individual property.

These requests serve different purposes and should be optimized differently.

⸻

## 4. Broad Rate Search

Once the traveler provides their destination, dates, occupancy, and other search criteria, search liteAPI for current rates and availability.

A geographic search may involve hundreds or thousands of relevant hotels.

Rather than placing all of those hotels into a single request, we recommend dividing the hotel IDs into groups of approximately 200 hotels per request.

For example:

Destination Search
↓
2,000 Relevant Hotels
↓
10 Requests × \~200 Hotels
↓
Run Requests Asynchronously
↓
Combine Successful Results
↓
Hotel Results Page

Running these requests asynchronously allows your application to search a large number of properties while keeping the overall response time low.

### Recommended Rate Search Timeout

For broad rate searches, we recommend setting an application-level timeout of approximately 6 seconds.

This should put you roughly within the 95th–99th percentile of response times while preventing unusually slow supplier responses from delaying the entire search experience.

The full upstream timeout can be considerably longer—potentially a minute or more—so you should not normally rely on the server-side timeout for an interactive shopping experience.

A recommended implementation is:

1. Divide the relevant hotels into batches of approximately 200.
2. Send those requests asynchronously.
3. Allow approximately 6 seconds for responses.
4. Combine the successful results.
5. Present the available inventory.

For shopping, it is generally better to return the available results quickly than to delay the entire results page waiting for a small number of slow responses.

⸻

## 5. Optimize the Hotel Results Page

The initial hotel results page does not normally need every available room and rate for every property.

Its primary purpose is to answer:

Which hotels are available, and what is the starting price?

Use maxRates to limit the amount of rate data returned.

We recommend setting:

`maxRates = number of rooms requested`

For the most common single-room search:

`maxRates = 1`

This retrieves the cheapest applicable rate needed to represent the hotel on the listing page without returning hundreds of unnecessary rate options.

You also generally do not need Room Mapping during this initial search.

### Recommended Listing Search Configuration

* Hotels per request: \~200
* Requests: Asynchronous
* Application timeout: \~6 seconds
* maxRates: Number of rooms requested
* Room Mapping: Not required

Combine the returned live rate information with your static hotel content to build the hotel results page.

⸻

## 6. Hotel Landing Page and Room Selection

When the traveler selects a hotel, the goal of the rate request changes.

You are no longer trying to find the cheapest rate across hundreds of properties. You now want to show the traveler the available rooms and rate options for a single hotel.

Perform another rate search for that individual property.

At this stage, increase maxRates substantially.

For example:

`maxRates = 500`

You should also enable **Room Mapping.**

Room Mapping allows returned rates to be associated with their underlying rooms, making it possible to organize multiple rates for the same room together.

This creates a progressive shopping model:<br /><br />

```text
AREA SEARCH
~200 hotels/request
Async requests
~6 second timeout
maxRates = rooms requested
Room Mapping not required
        ↓
HOTEL SELECTED
        ↓
HOTEL RATE SEARCH

Single hotel
maxRates ≈ 500
Room Mapping enabled
        ↓
ROOM / RATE SELECTION
```

This approach keeps broad searches lightweight while performing the more expensive room and rate retrieval only after the traveler has demonstrated interest in a specific property.

The hotel landing page can combine these live rates with the richer static content available through Hotel Details, such as property information, images, amenities, and room content.

Again, your liteAPI Whitelabel can be useful as a reference for the types of content that can be displayed at this stage.

⸻

## 7. Prebook

Once the traveler selects a room and rate, send the selected rate to Prebook.

Prebook validates the selected rate before you proceed with payment and booking.

From this point onward, the flow becomes transactional:

Selected Rate
↓
Prebook
↓
Payment
↓
Book
↓
Confirmation

Because hotel inventory and pricing are dynamic, keep the time between Prebook and Book as short as reasonably possible.

### Prebook Timeout

Prebook should be treated differently from the broad shopping requests earlier in the funnel.

During a broad search, receiving most of the available hotel results quickly is generally preferable to waiting significantly longer for every possible result.

During Prebook, however, the traveler has selected a specific product and is attempting to purchase it.

We therefore generally recommend allowing Prebook to run for the full timeout, which can be approximately 2 minutes.

You can implement a shorter application-level timeout for Prebook if required by your user experience.

However, if your application stops waiting before receiving a successful Prebook response, you should not continue as though the selected rate was successfully validated.

⸻

## 8. Payment

Payment should occur after Prebook and before Book.

How this works depends on whether you’re using the liteAPI Payment SDK or implementing your own payment experience.

### Using the liteAPI Payment SDK

If you’re using the liteAPI Payment SDK, configure Prebook for Payment SDK usage.

The overall flow remains:

Prebook
↓
Payment
↓
Book
↓
Payment Confirmation

The Payment SDK handles the underlying payment workflow for you, including the applicable Payment Intent lifecycle.

This is generally the simplest approach if you want liteAPI to handle the hotel payment experience.

### Building Your Own Payment Experience

If you’re not using the Payment SDK, we recommend using Payment Intents for your own payment implementation.

The recommended sequence is:

Prebook
↓
Payment Intent
↓
Book
↓
Confirm Intent

Payment will need to include your own markup here, and you would be booking via `ACC_CREDIT_CARD` available to everyone or `CREDIT` if you are an enterprise with a signed contract.

Prebook should validate the selected rate immediately before entering the payment and booking process.

⸻

## 9. Book

After Prebook and the required payment step, submit the booking.

Unlike a broad rate search, **Book should normally be allowed to run for the full timeout**, which can be up to 2 minutes. (Though usually much faster)

Once Book has been submitted, the actual reservation is being processed with the supplier or hotel.

That makes client-side timeouts particularly important to handle correctly.

### A Book Timeout Does Not Mean the Booking Failed

If your application stops waiting for the Book response, the booking request may still be processing upstream.

Therefore:

Client / HTTP Timeout
≠
Booking Failed

Instead, treat the result as:

Booking Status Unknown

Do **not** automatically submit another booking simply because the original request timed out.

The original booking may still complete.

If you want to use an. Async process instead of waiting, use the Manage Booking endpoints to asynchronously determine whether the booking ultimately completed or failed.

A resilient asynch implementation should support:

```text
      BOOK
       │
       ▼
Response Received?
  ╱           ╲
YES            NO
│              │
│              ▼
│        STATUS UNKNOWN
│              │
│              ▼
│       Manage Booking
│        Status Check
│              │
└───────┬──────┘
        │
        ▼
   FINAL STATUS
```

<br />

This prevents an uncertain network response from becoming a duplicate reservation.

⸻

## Use `clientReference` for Idempotency

Use a unique `clientReference` for each booking transaction.

Your application should generate and store this value and associate it with the traveler’s booking attempt.

For example:

Checkout Session<br />↓<br />Generate `clientReference`<br />↓<br />Prebook / Payment / Book<br />↓<br />Store Booking Relationship

If a Book response is lost or times out, you can attempt to create a new transaction as long as you use `clientReference` since the booking will fail if that `clientReference`  has been used before.

Use `clientReference` as part of your idempotency strategy and resolve the existing booking state.

⸻

## 11. Payment Confirmation

Once the booking result is known, complete the associated payment workflow.

When using the liteAPI Payment SDK, this process is handled automatically.

For your own Payment Intent implementation, the expected sequence is:

Prebook
↓
Payment Intent
↓
Book
↓
Booking Confirmed
↓
Confirm Intent

Your application should treat booking state and payment state as related but distinct parts of the transaction.

A payment operation does not by itself mean that a hotel reservation was successfully created.

Similarly, if the booking response is unknown because of a timeout, resolve the final booking state rather than immediately assuming that the transaction failed.

If the Booking fails instead of being confirmed then you should release the hold created by the payment intent.

⸻

## 12. Recommended End-to-End Architecture

Putting everything together, a typical liteAPI hotel integration looks like this:

```text
┌─────────────────────────────────┐
│          SEARCH PAGE            │
│                                 │
│ Destination                     │
│ Dates                           │
│ Guests / Occupancy              │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│        AREA RATE SEARCH         │
│                                 │
│ \~200 hotels/request             │
│ Async requests                  │
│ \~6 second timeout               │
│ maxRates = rooms requested      │
│ Room Mapping not required       │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│       HOTEL RESULTS PAGE        │
│                                 │
│ Static hotel content            │
│ + Live availability             │
│ + Starting price                │
└────────────────┬────────────────┘
                 │
           Hotel selected
                 │
                 ▼
┌─────────────────────────────────┐
│       HOTEL LANDING PAGE        │
│                                 │
│ Rich hotel content              │
│ Single-hotel rate search        │
│ maxRates ≈ 500                  │
│ Room Mapping enabled            │
└────────────────┬────────────────┘
                 │
            Rate selected
                 │
                 ▼
┌─────────────────────────────────┐
│             PREBOOK             │
│                                 │
│ Validate selected rate          │
│ Allow full timeout              │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│             PAYMENT             │
│                                 │
│ liteAPI Payment SDK             │
│              OR                 │
│ Payment Intent                  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│              BOOK               │
│                                 │
│ Unique clientReference          │
│ Allow full timeout              │
└────────────────┬────────────────┘
                 │
           Result known?
           ╱       ╲
         YES        NO
          │          │
          │          ▼
          │    Manage Booking
          │     Status Check
          │          │
          └────┬─────┘
               │
               ▼
┌─────────────────────────────────┐
│          CONFIRMATION           │
│                                 │
│ Final booking state             │
│ Final payment state             │
└─────────────────────────────────┘
```

⸻

## 13. Recommended Settings at a Glance

| Stage                          | Recommended Approach                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Property discovery             | Local content, Google Places, latitude/longitude, or your own geographic data |
| Static hotel content           | Cache locally if appropriate                                                  |
| Static content synchronization | Countries → Hotels → Hotel Details                                            |
| Static content updates         | Incremental synchronization using `lastUpdatedAt`                             |
| Hotels per broad rate request  | \~200                                                                         |
| Broad rate requests            | Run asynchronously                                                            |
| Broad rate-search timeout      | \~6 seconds                                                                   |
| Results-page `maxRates`        | Number of rooms requested                                                     |
| Results-page Room Mapping      | Usually unnecessary                                                           |
| Individual hotel `maxRates`    | \~500                                                                         |
| Individual hotel Room Mapping  | Enabled                                                                       |
| Prebook timeout                | Generally allow full timeout (\~2 minutes)                                    |
| Payment                        | liteAPI Payment SDK or Payment Intents                                        |
| Book timeout                   | Allow full timeout (\~2 minutes)                                              |
| Booking Status Unknown         | Resolve with Manage Booking endpoints.                                        |
| Booking idempotency            | Unique `clientReference`                                                      |
| Payment confirmation           | After successful booking; Payment SDK handles this when applicable            |

⸻

## 14. Key Integration Principles

The most important architectural principle is to **do more work as traveler intent increases.**.

A traveler browsing a destination does not need every rate for every room at every hotel.

A traveler looking at a specific hotel needs considerably more information.

A traveler who selects a room needs that exact rate validated.

And once a traveler submits a booking, reliability becomes more important than the aggressive timeouts used during shopping.

Think of the integration as a funnel:

```text
SEARCH
Fast + Broad
     │
     ▼
RATE RESULTS
\~200 hotels/request
Minimal rate data
     │
     ▼
HOTEL LANDING PAGE
One property
Rich static content
Full room/rate selection
     │
     ▼
PREBOOK
Validate exact product
     │
     ▼
PAYMENT
Prepare transaction
     │
     ▼
BOOK
Create reservation
     │
     ▼
CONFIRMATION
Resolve final booking
and payment state
```

<br />

The broader the search, the lighter and faster the request should be.

As traveler intent increases, retrieve progressively richer information and spend more time validating the transaction.

This architecture keeps broad hotel searches responsive while providing the rate validation, payment handling, idempotency, and booking reliability required when a traveler is ready to purchase.