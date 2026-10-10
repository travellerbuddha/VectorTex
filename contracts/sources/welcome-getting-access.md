> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/getting-access-and-testing-our-api.md).

# Getting Access & Testing our API

### Getting Access to our API&#x20;

* You will need an API key to test the staging (test environment)
* You can get an API key with any of the 3 following options:

1. Contacting us directly at partnerships\[at]welcomepickups.com&#x20;
2. Signing up on the form linked to this page <https://partner.welcomepickups.com/affiliates/>&#x20;
3. Asking your account manager via email.

### Environments

*We have 2 environments, Production & Staging.*&#x20;

* **Staging:** PlatformAddress -  <https://api.stgazure.welcomd.com/>
* **Production:**  PlatformAddress -  <https://api.welcomepickups.com/&#x20>;

The API accepts only HTTP requests with Content-Type set to **application/vnd.api+json** along with a **JSON body payload** depending on the operation to be performed.&#x20;

All responses are JSON content.

All operations follow this address pattern:

```
[PlatformAddress]/v1/external/[Resource]/[Operation]
```

**PlatformAddress** - The base address of the  API, depends on the environment (staging, production).

**Resource** - Logical group of operations, in most cases, identifies the target of the operations.

**Operation** - Name of the operation to be performed.

### Authentication

All operations of the API require an **api key** to be present in the request. Those are used to authenticate incoming requests.\
\
The api key can be provided in each request either as a **url parameter** like for example \
`?api_key=<api_key>` or as a **header** in the form of `Authorization: Bearer <api_key>`.

### How to test

* Endpoint: <https://api.stgazure.welcomd.com/v1/external/>

* API Key (we will share it with you)

* **Scenarios for Quotes & Bookings on our Test server:**
  * City: Athens and for Welcome Pickups service
  * City: Rome for Third-party service.&#x20;

### If you are using Postman

We have prepared scenarios for all API endpoints on our Staging environment. You can download the postman file, import it and add your API key to start exploring.&#x20;

* Download the "External API Postman.zip" file.
* Extract and import to your postman application the files "External API Staging.postman\_environment.json" and "External API.postman\_collection.json".
* At the “api\_key” environment variable add the API Key that you got from our team.
* Start sending requests.

<figure><img src="https://1299330001-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F9NuJNo2544pdf2OzRyth%2Fuploads%2FOlnKLWFFyW2YZWXYi8aV%2F2023-03-21_17-44.png?alt=media&amp;token=757d1eaa-c593-4e60-b14b-97089845be9d" alt=""><figcaption><p>Importing the api_key to postman</p></figcaption></figure>

{% file src="/files/gUfCyRpwjQLwHPb2md04" %}
Postman File&#x20;
{% endfile %}

<br>
