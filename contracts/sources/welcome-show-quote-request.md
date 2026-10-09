> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/quote-requests/show-a-quote-request.md).

# Show a Quote request

## Show a Quote request

<mark style="color:blue;">`GET`</mark> `{PlatformAddress}/v1/external/quote_requests/{quote-request­-id}`

Use this endpoint to view the details of a quote­ request.

#### Query Parameters

| Name                                                 | Type   | Description                                                                                                     |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| api\_key<mark style="color:red;">\*</mark>           | String | The access key for making API calls.                                                                            |
| quote\_request\_id<mark style="color:red;">\*</mark> | String | Id of [Quote request](/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md#quote-request) |

{% tabs %}
{% tab title="200: OK Quote request details" %}

```json
{
    "data": {
        "id": "6dle8xpw",
        "type": "quote_requests",
        "attributes": {
            "from_location": {
                "type": "airport",
                "description": "Athens Airport, Athens International Airport, Eleftherios Venizelos",
                "lat": 37.935647,
                "lng": 23.948416
            },
            "to_location": {
                "type": null,
                "description": null,
                "lat": 38.0576045,
                "lng": 23.5415316
            },
            "from_date": "2023-02-09",
            "from_time": "09:50",
            "number_of_passengers": 2,
            "number_of_luggage": 2,
            "created_at": "2023-02-06T15:45:27+02:00",
            "count_of_total_quotes_returned": 1
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "9qDNLBYn",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "9qDNLBYn",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "6dle8xpw",
                "status": null,
                "operator": "welcome",
                "expires_at": "2023-02-07T15:45:27+02:00",
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
                    "price": 62.0,
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
    ]
}
```

{% endtab %}

{% tab title="400: Bad Request " %}

```javascript
```

{% endtab %}

{% tab title="404: Not Found Object not found" %}

```json
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "Quote request with id 6dle8xpws is missing"
        }
    ]
}
```

{% endtab %}

{% tab title="500: Internal Server Error " %}

```javascript
```

{% endtab %}

{% tab title="200: OK Operator: Third-party" %}

```json
{
    "data": {
        "id": "YZBb7DZ6",
        "type": "quote_requests",
        "attributes": {
            "from_location": {
                "type": "airport",
                "description": "Fiumicino Airport , Fiumicino, Leonardo da Vinci International Airport, FCO",
                "lat": 41.795083,
                "lng": 12.250137
            },
            "to_location": {
                "type": "hotel",
                "description": "A.Roma Lifestyle Hotel, Via Giorgio Zoega 59, Gianicolense, 00164 Rome, Italy",
                "lat": 41.876313,
                "lng": 12.432052
            },
            "from_date": "2023-04-30",
            "from_time": "13:30",
            "number_of_passengers": 2,
            "number_of_luggage": 2,
            "created_at": "2023-03-21T15:14:36+02:00",
            "count_of_total_quotes_returned": 2
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "6l923WJZ",
                        "type": "quotes"
                    },
                    {
                        "id": "oJW9Kdzw",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "6l923WJZ",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "YZBb7DZ6",
                "status": null,
                "operator": "jayride",
                "expires_at": "2023-03-22T15:14:37+02:00",
                "service_info": {
                    "type": "private",
                    "vehicle_type": "sedan",
                    "max_pax": 4,
                    "max_lug": 4,
                    "photo_url": "//staging-res.jayride.com/web/dotcom/vehicle/370x300/car-business-sedan.png",
                    "photo_urls": [
                        "//staging-res.jayride.com/web/dotcom/vehicle/370x300/car-business-sedan.png",
                        "https://jayride-testing.imgix.net/8/8056bafc-2074-41de-882f-d5fddbc5eb0d.jpg?fit=crop&w=370&h=300",
                        "https://jayride-testing.imgix.net/e/e21a7227-5148-4696-a8a3-7a218c8d9f4b.jpg?fit=crop&w=370&h=300",
                        "https://jayride-testing.imgix.net/5/53455cd7-579d-4cfe-8993-698f8d6d0477.jpg?fit=crop&w=370&h=300"
                    ],
                    "description": null,
                    "supplier": {
                        "id": null,
                        "name": null,
                        "photo_url": null,
                        "description": null
                    },
                    "passenger_reviews": {
                        "count": null,
                        "average_rating": null
                    }
                },
                "fare": {
                    "price": 79,
                    "currency_code": "EUR",
                    "type": "confirmed",
                    "refund_cancellation_policy": "You are eligible for a 100% refund on your booking, with no cancellation fees, for cancellations greater than 24 hours prior to your pick-up departure time.",
                    "refund_policies": [
                        {
                            "method": "refund",
                            "percent": 1,
                            "minute_prior": 1440
                        }
                    ]
                }
            }
        },
        {
            "id": "oJW9Kdzw",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "YZBb7DZ6",
                "status": null,
                "operator": "jayride",
                "expires_at": "2023-03-22T15:14:37+02:00",
                "service_info": {
                    "type": "private",
                    "vehicle_type": "sedan",
                    "max_pax": 4,
                    "max_lug": 4,
                    "photo_url": "//staging-res.jayride.com/web/dotcom/vehicle/370x300/car-economy-sedan.png",
                    "photo_urls": [
                        "//staging-res.jayride.com/web/dotcom/vehicle/370x300/car-economy-sedan.png"
                    ],
                    "description": null,
                    "supplier": {
                        "id": null,
                        "name": null,
                        "photo_url": null,
                        "description": null
                    },
                    "passenger_reviews": {
                        "count": null,
                        "average_rating": null
                    }
                },
                "fare": {
                    "price": 75,
                    "currency_code": "EUR",
                    "type": "confirmed",
                    "refund_cancellation_policy": "You are eligible for a 100% refund on your booking, with no cancellation fees, for cancellations greater than 24 hours prior to your pick-up departure time.",
                    "refund_policies": [
                        {
                            "method": "refund",
                            "percent": 1,
                            "minute_prior": 1440
                        }
                    ]
                }
            }
        }
    ]
}
```

{% endtab %}
{% endtabs %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>object of <a href="#create-a-quote-request">Quote request</a></td><td>Required</td><td>Details of a Quote request</td></tr></tbody></table>

### Quote Request

<table><thead><tr><th>Property</th><th>Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>from_location</td><td>Hash</td><td></td><td>From location object</td></tr><tr><td>from_location[type]</td><td>String</td><td></td><td>From location type</td></tr><tr><td>from_location[description]</td><td>String</td><td></td><td>From location description</td></tr><tr><td>from_location[lat]</td><td>Double</td><td></td><td>From location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td></td><td>From location longitude</td></tr><tr><td>to_location</td><td>Hash</td><td></td><td>To location object</td></tr><tr><td>to_location[type]</td><td>String</td><td></td><td>To location type</td></tr><tr><td>to_location[description]</td><td>String</td><td></td><td>To location description</td></tr><tr><td>to_location[lat]</td><td>Double</td><td></td><td>To location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td></td><td>To location longitude</td></tr><tr><td>from_date</td><td>String</td><td></td><td>Requested date of transfer</td></tr><tr><td>from_time</td><td>String</td><td></td><td>Requested time of transfer</td></tr><tr><td>number_of_passengers</td><td>Integer</td><td></td><td>Number of passengers</td></tr><tr><td>number_of_luggage</td><td>Integer</td><td></td><td>Number of luggage  pieces</td></tr><tr><td>created_at</td><td>String</td><td></td><td>Quote request creation date time</td></tr><tr><td>count_of_total_quotes_returned</td><td>Integer</td><td></td><td>Number of quotes returned for this specific quote request</td></tr></tbody></table>

### Included

### Quote

<table><thead><tr><th>Property</th><th>Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_request_id</td><td>String</td><td></td><td>Quote request id</td></tr><tr><td>status</td><td>String</td><td></td><td>Quote status. Can be one of:<br>1. price-confirmed<br>2. price-estimated</td></tr><tr><td>operator</td><td>String</td><td></td><td>Quote ride operator</td></tr><tr><td>expires_at</td><td>String</td><td></td><td>Quote expiration date</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Quote service information</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td><p>Vehicle type of service.</p><p>Can be one of:</p><p>1. sedan</p><p>2. minivan</p><p>3. minibus</p></td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of service</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Object that contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Hash</td><td></td><td>Object of available policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of each policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][method]</td><td>String</td><td></td><td>Cancellation refund method<br>(In case of Third-party operator)</td></tr><tr><td>fare[refund_policies][percent]</td><td>Double</td><td></td><td>Cancellation refund percent<br>(In case of Third-party operator)</td></tr><tr><td>fare[refund_policies][minute_prior]</td><td>Integer</td><td></td><td>Minimum minutes from operation for a policy<br>(In case of Third-party operator)</td></tr></tbody></table>
