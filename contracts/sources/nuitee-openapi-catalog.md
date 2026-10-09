---
updatedAt: 2026-09-17T12:50:36.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# OpenAPI Specifications

This page collects the OpenAPI specifications for all Nuitee Connect services. Use the links below to explore endpoints, schemas, and examples for each API domain. These specs are the source of truth for integration, testing, and client generation.

# What are OpenAPI Specifications?

OpenAPI Specifications (often shortened to “OpenAPI docs” or “OAS”) are a standard, machine-readable way to describe a REST API. They define what endpoints exist, how to call them, and what you can expect back.

An OpenAPI spec typically includes:

* **Endpoints** and methods (e.g., GET /hotels/search)
* **Parameters** (path, query, headers, body)
* **Authentication** schemes (API keys, OAuth, etc.)
* **Request** and **response** schemas (data models, field types, required vs optional)
* **Error** formats
* Examples for common use cases

Because it’s standardized, the same OpenAPI file can power interactive docs, code generators, test tools, and more.

# OpenAPI Specifications for Nuitee Connect

<HTMLBlock>{`
<div class="liteapi-openapi">
  <style>
    .liteapi-openapi {
      --bg: #564DA2;
      --card: #564DA2;
      --card-hover: #564DA2;
      --text: #e6e9f5;
      --muted: #a7b0d0;
      --accent: #E8E5FF;
      --accent-2: #6ee7b7;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      color: var(--text);
    }

    .liteapi-openapi .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-top: 12px;
    }

    .liteapi-openapi a.card {
      display: block;
      text-decoration: none;
      color: inherit;
      background: linear-gradient(180deg, var(--card), #4D56A6);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 14px 14px 12px;
      transition: transform .12s ease, background .12s ease, border-color .12s ease, box-shadow .12s ease;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      position: relative;
      overflow: hidden;
    }

    .liteapi-openapi a.card:hover {
      transform: translateY(-2px);
      background: linear-gradient(180deg, var(--card-hover), #564DA2);
      border-color: rgba(122,162,255,0.5);
      box-shadow: 0 10px 26px rgba(0,0,0,0.35);
    }

    .liteapi-openapi .row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }

    .liteapi-openapi .icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      font-size: 18px;
      background: rgba(122,162,255,0.12);
      border: 1px solid rgba(122,162,255,0.25);
      flex: 0 0 auto;
    }

    .liteapi-openapi .title {
      font-weight: 700;
      font-size: 16px;
      letter-spacing: 0.2px;
    }

    .liteapi-openapi .desc {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      margin-bottom: 8px;
      min-height: 36px;
    }

    .liteapi-openapi .meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
      opacity: 0.95;
    }

    .liteapi-openapi .pill {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(110,231,183,0.12);
      border: 1px solid rgba(110,231,183,0.28);
      color: #c9ffe7;
      font-weight: 600;
      letter-spacing: 0.2px;
    }

    .liteapi-openapi .arrow {
      color: var(--accent);
      font-weight: 700;
      letter-spacing: 0.3px;
    }
  </style>

  <div class="grid">
    <a class="card" href="https://docs.liteapi.travel/openapi/api-search.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">🔎</div>
        <div class="title">Search API</div>
      </div>
      <div class="desc">
        Hotel search & availability discovery endpoints, with filters, maps, and rate options.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-booking.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">🧾</div>
        <div class="title">Booking API</div>
      </div>
      <div class="desc">
        Create, confirm, cancel, and retrieve bookings. Includes pre-book checks and validation.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/openapiflights.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">✈️</div>
        <div class="title">Flights API</div>
      </div>
      <div class="desc">
        Search flights, manage bookings, and access static flight data including airlines and airports.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-experiences.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">🗺️</div>
        <div class="title">Experiences API</div>
      </div>
      <div class="desc">
        Search tours and activities, check availability and reviews, and manage booking options.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-hotel-data.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">🏨</div>
        <div class="title">Hotel Data API</div>
      </div>
      <div class="desc">
        Property content, images, amenities, policies, and other static hotel details.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-loyalty.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">🎁</div>
        <div class="title">Loyalty API</div>
      </div>
      <div class="desc">
        Member pricing, tier benefits, loyalty identifiers, and program integration endpoints.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-vouchers.json" target="_blank" rel="noopener">
      <div class="row">
        <div class="icon">🎟️</div>
        <div class="title">Vouchers API</div>
      </div>
      <div class="desc">
        Voucher issuance, redemption, and tracking for promotional or compensation flows.
      </div>
      <div class="meta">
        <span class="pill">OpenAPI</span>
        <span class="arrow">View spec →</span>
      </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-analytics.json" target="_blank" rel="noopener">
    <div class="row">
      <div class="icon">📊</div>
      <div class="title">Analytics API</div>
    </div>
    <div class="desc">
      Events, metrics, and reporting endpoints to track usage, performance, insights.
    </div>
    <div class="meta">
      <span class="pill">OpenAPI</span>
      <span class="arrow">View spec →</span>
    </div>
    </a>
    
		<a class="card" href="https://docs.liteapi.travel/openapi/api-price-index.json" target="_blank" rel="noopener">
    <div class="row">
      <div class="icon">💵</div>
      <div class="title">Price index API</div>
    </div>
    <div class="desc">
      Price index for cities and hotels to gather insights on price per night on each day, up to a year in the future.
    </div>
    <div class="meta">
      <span class="pill">OpenAPI</span>
      <span class="arrow">View spec →</span>
    </div>
    </a>

    <a class="card" href="https://docs.liteapi.travel/openapi/api-mapping.json" target="_blank" rel="noopener">
    <div class="row">
      <div class="icon">🔗</div>
      <div class="title">Mapping API</div>
    </div>
    <div class="desc">
      Map partner hotel inventories to Nuitee catalogue IDs, and match or group supplier rooms against a reference catalog.
    </div>
    <div class="meta">
      <span class="pill">OpenAPI</span>
      <span class="arrow">View spec →</span>
    </div>
    </a>

  </div>
</div>
`}</HTMLBlock>

<br />

***

# Why OpenAPI docs are useful

## 1. A single source of truth

Instead of relying on scattered README notes or outdated wiki pages, **OpenAPI specs act as the contract between Nuitee Connect and integrators**. If the spec says something is supported, it is. If it changes, the contract changes with it.

***

## 2. Faster, safer integrations

Developers can quickly answer:

* Which endpoint should I use?
* What parameters are required?
* What does the response look like?
* What errors should I handle?

That cuts down on guesswork, support tickets, and integration bugs.

***

## 3. Interactive exploration

Most OpenAPI specs can be opened in tools like Swagger UI or Redoc, giving a “try it now” experience:

* Send requests in the browser
* See real responses
* Inspect schemas without digging through code

This is especially helpful when you’re learning the API or debugging an integration.

***

## 4. Auto-generated SDKs and clients

Because OpenAPI is machine readable, you can generate client libraries in many languages:

* TypeScript / JavaScript
* Python
* Go
* Java / Kotlin
* C#
* …and more.

This means less manual boilerplate and fewer integration mistakes.

***

## 5. Better testing and validation

OpenAPI specs enable:

* Contract testing (is your client matching the API?)
* Mock servers (simulate Nuitee Connect responses)
* Automated validation of requests/responses

It becomes much easier to catch breaking changes early.