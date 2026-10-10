---
updatedAt: 2026-06-18T14:30:39.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Performance, Reliability & Rate Limiting

Nuitee Connect is designed to provide reliable, predictable API performance at scale. This page describes Nuitee Connect’s performance characteristics, availability targets, rate limiting behavior, and observability features available to customers.

## API Response Times

Nuitee Connect continuously monitors API performance across all major endpoints.

Under normal operating conditions:

* **Average response time** for **rate search** and **prebooking** requests is **below 3 seconds**
* Response times may vary depending on:

  * Requested destination and inventory size
  * Upstream supplier response times
  * Request complexity and filters

Nuitee Connect is designed to optimize latency while maintaining data accuracy and availability.

***

## Reliability and Error Rates

Nuitee Connect tracks API reliability and error ratios across production environments.

Typical metrics include:

* **5xx error ratio below 0.05%**
* Automatic detection and alerting for abnormal error spikes
* Rapid investigation and mitigation of upstream or infrastructure-related issues

Client-side errors (4xx) are excluded from service error ratio calculations.

***

## Rate Limiting

To ensure platform stability and fair usage, Nuitee Connect enforces rate limits on API requests.

### Default Limits

* **500 requests per second (RPS)** per customer
* Rate limits apply across all API endpoints

When the rate limit is exceeded:

* Requests are rejected with HTTP **`429 Too Many Requests`**
* Clients are expected to implement retry and backoff logic

***

### Higher Rate Limits

Higher rate limits may be granted based on:

* Use case requirements
* Traffic patterns
* Infrastructure capacity planning

Customers requiring higher throughput should contact Nuitee Connect support to discuss custom limits.

***

## Throttling Behavior

Rate limiting and throttling mechanisms are designed to:

* Protect platform stability
* Prevent abusive or accidental traffic spikes
* Ensure consistent performance for all customers

Throttling is applied automatically and transparently when limits are exceeded.

***

## Monitoring & Observability for Customers

Nuitee Connect provides customers with visibility into their API usage and performance through the **Nuitee Connect Dashboard**.

Available metrics include:

* API response times
* Request volume and rate
* Error rates (4xx / 5xx)
* Rate limiting events
* Historical usage and performance logs

This allows customers to:

* Monitor real-time performance
* Investigate historical issues
* Optimize integrations and traffic patterns

***

## Customer Responsibilities

Customers are responsible for:

* Implementing retries with exponential backoff for transient errors
* Handling HTTP 429 responses appropriately
* Monitoring their own API usage and performance metrics
* Designing integrations that tolerate occasional upstream delays

***

## Continuous Optimization

Nuitee Connect continuously evaluates performance and reliability metrics to:

* Improve response times
* Reduce error rates
* Scale infrastructure in line with customer demand