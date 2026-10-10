> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md).

# Create a Quote request

## Create a Quote request

<mark style="color:green;">`POST`</mark> `{PlatformAddress}/v1/external/quote-requests`

Use this endpoint to create quote requests and get back quotes that can be used later on with the purpose of booking a transfer.

#### Query Parameters

| Name                                       | Type   | Description                          |
| ------------------------------------------ | ------ | ------------------------------------ |
| api\_key<mark style="color:red;">\*</mark> | String | The access key for making API calls. |

#### Headers

| Name          | Type   | Description                                                                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | String | <p>Authorization token can be used instead of the <strong>api\_key</strong> url parameter.</p><p></p><p>e.g. Authorization: Bearer token</p> |

#### Request Body

<table><thead><tr><th width="287">Name</th><th width="110">Type</th><th>Description</th></tr></thead><tbody><tr><td>from_location<mark style="color:red;">*</mark></td><td>Hash</td><td>From location object</td></tr><tr><td>from_location[id]</td><td>String</td><td>Id of <a href="/api-docs/reference/api-reference/hubs.md#hub">Hub</a></td></tr><tr><td>from_location[google_place_id]</td><td>String</td><td>Google place id</td></tr><tr><td>from_location[iata_code]</td><td>String</td><td>IATA code</td></tr><tr><td>from_location[port_code]</td><td>String</td><td>Port code</td></tr><tr><td>from_location[description]</td><td>String</td><td>Precise transfer pickup location description as a string</td></tr><tr><td>from_location[lat]</td><td>Double</td><td>Precise transfer pickup location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td>Precise transfer pickup location longitude</td></tr><tr><td>to_location<mark style="color:red;">*</mark></td><td>Hash</td><td>To location object</td></tr><tr><td>to_location[id]</td><td>String</td><td>Id of <a href="/api-docs/reference/api-reference/hubs.md#hub">Hub</a></td></tr><tr><td>to_location[google_place_id]</td><td>String</td><td>Google place id</td></tr><tr><td>to_location[iata_code]</td><td>String</td><td>IATA code</td></tr><tr><td>to_location[port_code]</td><td>String</td><td>Port code</td></tr><tr><td>to_location[description]</td><td>String</td><td>Precise transfer drop-off location description as a string</td></tr><tr><td>to_location[lat]</td><td>Double</td><td>Precise transfer drop-off location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td>Precise transfer drop-off location longitude</td></tr><tr><td>pickup_date<mark style="color:red;">*</mark></td><td>String</td><td>Pickup date<br>(Format: ISO8601 yyyy-MM-dd (date) e.g. "2023-06-25")</td></tr><tr><td>pickup_time<mark style="color:red;">*</mark></td><td>String</td><td>Pickup time<br>(Format: HH:mm e.g. "09:50")</td></tr><tr><td>passengers<mark style="color:red;">*</mark></td><td>Integer</td><td>Number of passengers</td></tr><tr><td>luggage</td><td>Integer</td><td>Number of luggage</td></tr><tr><td>infant_seats</td><td>Integer</td><td>Number of infant seats<br><br>(Infant seat is for babies 0 - 6 months old)</td></tr><tr><td>child_seats</td><td>Integer</td><td>Number of child seats<br><br>(Child seat is for children 6 months - 3 years old)</td></tr><tr><td>booster_seats</td><td>Integer</td><td>Number of booster seats<br><br>(Booster seat is for children 3 - 12 years old)</td></tr></tbody></table>

{% tabs %}
{% tab title="201: Created Operator: Welcome" %}

```json
{
    "data": {
        "id": "W5P3J8lL",
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
            "created_at": "2023-02-07T12:20:10+02:00",
            "count_of_total_quotes_returned": 1
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "MnD7E2Yq",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "MnD7E2Yq",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "W5P3J8lL",
                "status": "price-estimated",
                "operator": "welcome",
                "expires_at": "2023-02-07T12:35:10+02:00",
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
                    "type": "estimated",
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

{% tab title="400: Bad Request Bad Request" %}

```json
// Missing required parameter
{
    "errors": [
        {
            "status": "400",
            "title": "presence",
            "detail": "is missing",
            "source": {
                "parameter": "pickup_date"
            }
        }
    ]
}

// Invalid parameter
{
    "errors": [
        {
            "status": "400",
            "title": "regexp",
            "detail": "is invalid",
            "source": {
                "parameter": "pickup_date"
            }
        }
    ]
}

// Datetime is in the past
{
    "errors": [
        {
            "status": "400",
            "code": "bad_request",
            "title": "Bad request",
            "detail": "Datetime is in the past"
        }
    ]
}

// In case none of the id, google_place_id, iata_code, port_code or 
// the combination of (lat, lng, description) is provided
{
    "errors": [
        {
            "status": "400",
            "title": "presence",
            "detail": "is missing",
            "source": {
                "parameter": "from_location"
            }
        },
        {
            "status": "400",
            "title": "at_least_one",
            "detail": "are missing, at least one parameter must be provided",
            "source": {
                "parameter": "from_location[id]"
            }
        }
    ]
}

// In case more than one of the id, iata_code, port_code or 
// the combination of google_place_id + (lat, lng, description) is provided
{
    "errors": [
        {
            "status": "400",
            "code": "bad_request",
            "title": "Bad request",
            "detail": "Either the id, iata_code, port_code, or the combination of google_place_id, lat, lng and description or the combination of lat, lng and description. must be provided for the from_location"
        }
    ]
}

// When google_place_id is provided without the triplet of (lat, lng, description)
{
    "errors": [
        {
            "status": "400",
            "code": "bad_request",
            "title": "Bad request",
            "detail": "Either the id, iata_code, port_code, or the combination of google_place_id, lat, lng and description or the combination of lat, lng and description. must be provided for the from_location"
        }
    ]
}

// Location not found
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "From location not found"
        }
    ]
}
```

{% endtab %}

{% tab title="401: Unauthorized " %}

```javascript
```

{% endtab %}

{% tab title="500: Internal Server Error " %}

```javascript
```

{% endtab %}

{% tab title="201: Created Operator: Third-party" %}

```json
{
    "data": {
        "id": "BO7wKKOn",
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
            "created_at": "2023-03-14T11:19:39+02:00",
            "count_of_total_quotes_returned": 2
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "xz44E8zn",
                        "type": "quotes"
                    },
                    {
                        "id": "kJgOYPJv",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "xz44E8zn",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "BO7wKKOn",
                "status": "price-confirmed",
                "operator": "jayride",
                "expires_at": "2023-03-15T11:19:40+02:00",
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
                    "price": 79.0,
                    "currency_code": "EUR",
                    "type": "confirmed",
                    "refund_cancellation_policy": "You are eligible for a 100% refund on your booking, with no cancellation fees, for cancellations greater than 24 hours prior to your pick-up departure time.",
                    "refund_policies": [
                        {
                            "method": "refund",
                            "percent": 1.0,
                            "minute_prior": 1440
                        }
                    ]
                }
            }
        },
        {
            "id": "kJgOYPJv",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "BO7wKKOn",
                "status": "price-confirmed",
                "operator": "jayride",
                "expires_at": "2023-03-15T11:19:40+02:00",
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
                    "price": 75.0,
                    "currency_code": "EUR",
                    "type": "confirmed",
                    "refund_cancellation_policy": "You are eligible for a 100% refund on your booking, with no cancellation fees, for cancellations greater than 24 hours prior to your pick-up departure time.",
                    "refund_policies": [
                        {
                            "method": "refund",
                            "percent": 1.0,
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

### Parameter validation

Please note that in order to get a response, apart from the already required parameters, **at least one of** and **only one of** the following must be provided for the **from\_location** and **to\_location**:

* id
* iata\_code&#x20;
* port\_code
* google\_place\_id + The combination of (lat, lng, description)
* The combination of (lat, lng, description) **(this option does NOT apply in airport and port locations)**

### Receiving an error with a status code of 200 OK

Sometimes, although a client's request is valid, there might be **no availability** for that particular request on Welcome's side. For that reason an error structured response but with a status code of 200 OK is returned.

<details>

<summary>200: OK with no availability error</summary>

```json
// No availability for requested number of Passengers / Luggage
{
    "errors": [
        {
            "status": "200",
            "code": "no_availability",
            "title": "No availability",
            "detail": "Blocked Max Pax/Lug Restrictions"
        }
    ]
}

// No availability for requested time
{
    "errors": [
        {
            "status": "200",
            "code": "no_availability",
            "title": "No availability",
            "detail": "No availability for the requested time"
        }
    ]
}
```

</details>

### Request example

{% code lineNumbers="true" %}

```json
// Example #1
{
    "from_location": {
        "id": "",
        "google_place_id": "ChIJ4eRGPxe9oRQRPAoBLGq0D7A",
        "description": "Acropolis Museum, Dionysiou Areopagitou 15, Athens 117 42, Greece",
        "lat": 37.969417,
        "lng": 23.729328,
        "iata_code": null,
        "port_code": null
    },
    "to_location": {
        "id": "",
        "google_place_id": "ChIJsa-EU-u9oRQR2lZ2an1mx40",
        "description": "Welcome Pickups Ltd., Leof. Andrea Siggrou 80-88, Athina 117 41, Greece",
        "lat": 37.964042,
        "lng": 23.725763,
        "iata_code": null,
        "port_code": null
    },
    "pickup_date": "2023-05-30",
    "pickup_time": "13:30",
    "passengers": 2,
    "luggage": 2,
    "infant_seats": null,
    "child_seats": null,
    "booster_seats": null
}

// Example #2
{
    "from_location": {
        "id": "",
        "google_place_id": "",
        "description": "",
        "lat": null,
        "lng": null,
        "iata_code": "ATH",
        "port_code": null
    },
    "to_location": {
        "id": "",
        "google_place_id": "ChIJsa-EU-u9oRQR2lZ2an1mx40",
        "description": "Welcome Pickups Ltd., Leof. Andrea Siggrou 80-88, Athina 117 41, Greece",
        "lat": 37.964042,
        "lng": 23.725763,
        "iata_code": null,
        "port_code": null
    },
    "pickup_date": "2023-05-30",
    "pickup_time": "13:30",
    "passengers": 2,
    "luggage": 2,
    "infant_seats": null,
    "child_seats": null,
    "booster_seats": 1
}
```

{% endcode %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>object of <a href="#create-a-quote-request">Quote request</a></td><td>Required</td><td>Details of a Quote request</td></tr></tbody></table>

### Quote Request

<table><thead><tr><th width="268">Property</th><th width="160">Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>from_location</td><td>Hash</td><td></td><td>From location object</td></tr><tr><td>from_location[type]</td><td>String</td><td></td><td>From location type</td></tr><tr><td>from_location[description]</td><td>String</td><td></td><td>From location description</td></tr><tr><td>from_location[lat]</td><td>Double</td><td></td><td>From location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td></td><td>From location longitude</td></tr><tr><td>to_location</td><td>Hash</td><td></td><td>To location object</td></tr><tr><td>to_location[type]</td><td>String</td><td></td><td>To location type</td></tr><tr><td>to_location[description]</td><td>String</td><td></td><td>To location description</td></tr><tr><td>to_location[lat]</td><td>Double</td><td></td><td>To location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td></td><td>To location longitude</td></tr><tr><td>from_date</td><td>String</td><td></td><td>Requested date of transfer</td></tr><tr><td>from_time</td><td>String</td><td></td><td>Requested time of transfer</td></tr><tr><td>number_of_passengers</td><td>Integer</td><td></td><td>Number of passengers</td></tr><tr><td>number_of_luggage</td><td>Integer</td><td></td><td>Number of luggage  pieces</td></tr><tr><td>created_at</td><td>String</td><td></td><td>Quote request creation date time</td></tr><tr><td>count_of_total_quotes_returned</td><td>Integer</td><td></td><td>Number of quotes returned for this specific quote request</td></tr></tbody></table>

### Included

### Quote

<table><thead><tr><th width="267">Property</th><th width="129">Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_request_id</td><td>String</td><td></td><td>Quote request id</td></tr><tr><td>status</td><td>String</td><td></td><td>Quote status. Can be one of:<br>1. price-confirmed<br>2. price-estimated</td></tr><tr><td>operator</td><td>String</td><td></td><td>Quote ride operator</td></tr><tr><td>expires_at</td><td>String</td><td></td><td>Quote expiration date</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Quote service information</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td><p>Vehicle type of service.</p><p>Can be one of:</p><p>1. sedan</p><p>2. minivan</p><p>3. minibus</p></td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of service</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Fare object.<br>Contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Array of Object</td><td></td><td>Object of available refund policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies<br>(In case of Welcome operator)</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of each policy<br>(In case of Welcome operator)</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy<br>(In case of Welcome operator)</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy<br>(In case of Welcome operator)</td></tr><tr><td>fare[refund_policies][method]</td><td>String</td><td></td><td>Cancellation refund method<br>(In case of Third-party operator)</td></tr><tr><td>fare[refund_policies][percent]</td><td>Double</td><td></td><td>Cancellation refund percent<br>(In case of Third-party operator)</td></tr><tr><td>fare[refund_policies][minute_prior]</td><td>Integer</td><td></td><td>Minimum minutes from operation for a policy<br>(In case of Third-party operator)</td></tr></tbody></table>
