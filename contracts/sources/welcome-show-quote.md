> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/quotes/show-a-quote.md).

# Show a Quote

## Show a Quote

<mark style="color:blue;">`GET`</mark> `{PlatformAddress}/v1/external/quote_requests/{quote-request-id}/quotes/{quote­-id​}`

Use this endpoint to view the details of a quote­.

#### Query Parameters

| Name                                                 | Type   | Description                          |
| ---------------------------------------------------- | ------ | ------------------------------------ |
| api\_key<mark style="color:red;">\*</mark>           | String | The access key for making API calls. |
| quote\_id<mark style="color:red;">\*</mark>          | String |                                      |
| quote\_request\_id<mark style="color:red;">\*</mark> | String |                                      |

{% tabs %}
{% tab title="200: OK Quote details" %}

```json
{
    "data": {
        "id": "kzAyDrz6",
        "type": "quotes",
        "attributes": {
            "quote_request_id": "rZveXEm4",
            "status": "price-estimated",
            "operator": "welcome",
            "expires_at": "2023-02-09T13:52:09+02:00",
            "service_info": {
                "type": null,
                "vehicle_type": "sedan",
                "max_pax": 4,
                "max_lug": 4,
                "photo_url": null,
                "photo_urls": null,
                "description": null,
                "supplier": null,
                "passenger_reviews": null
            },
            "fare": {
                "price": 130.0,
                "currency_code": "EUR",
                "type": null,
                "refund_cancellation_policy": "You are eligible for a 80% refund on your booking, for cancellations greater than 24 hours prior to your pick-up departure time.",
                "refund_policies": [
                    {
                        "hours_from_operation": {
                            "min": 24,
                            "max": "-"
                        },
                        "refund_percentage": 80
                    },
                    {
                        "hours_from_operation": {
                            "min": 0,
                            "max": 24
                        },
                        "refund_percentage": 0
                    }
                ]
            }
        }
    }
}
```

{% endtab %}

{% tab title="400: Bad Request " %}

```javascript
```

{% endtab %}

{% tab title="404: Not Found Object not found" %}

```json
// Quote request
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "Quote request with id rZveXEm4s is missing"
        }
    ]
}

// Quote
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "Quote with id kzAyDrz6s is missing"
        }
    ]
}
```

{% endtab %}

{% tab title="500: Internal Server Error " %}

```javascript
```

{% endtab %}
{% endtabs %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>object of <a href="/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md#quote">Quote</a></td><td>Required</td><td>Details of a Quote </td></tr></tbody></table>

### Quote

<table><thead><tr><th>Property</th><th>Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_request_id</td><td>String</td><td></td><td>Quote request id</td></tr><tr><td>status</td><td>String</td><td></td><td>Quote status. Can be one of:<br>1. price-confirmed<br>2. price-estimated</td></tr><tr><td>operator</td><td>String</td><td></td><td>Quote ride operator</td></tr><tr><td>expires_at</td><td>String</td><td></td><td>Quote expiration date</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Quote service information</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td><p>Vehicle type of service.</p><p>Can be one of:</p><p>1. sedan</p><p>2. minivan</p><p>3. minibus</p></td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of service</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Object that contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Hash</td><td></td><td>Object of available policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of each policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr></tbody></table>
