---
updatedAt: 2026-06-18T14:30:39.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Rate Limiting

To ensure fair use of resources, Nuitee Connect enforces rate limits on API requests. If you exceed the rate limits, you will receive a "429 Too Many Requests" response.

**Rate Limit Details:**

* **Sandbox API keys:**
  * 5 requests per second
* **Production API keys:**
  * 250 requests per second

**\
Handling Rate Limit Responses:**

```json
{
  "error": {
    "code": 429,
    "message": "Too many requests. Please try again later."
  }
}
```

Contact us about custom rate limits if you need a higher rate limit.

**Best Practices:**

* Implement exponential backoff when retrying requests.
* Monitor your usage in the Nuitee Connect dashboard.