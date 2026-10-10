> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/recipes.md).

# Recipes

This page provides some examples of how to utilize the endpoints available.

## Getting a quote

### Utilizing iata and port codes

In the [create quote request endpoint](/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md), **iata** and **port codes** can be utilized with the aim of resolving a location and getting a quote back.

<details>

<summary>Example JSON payload</summary>

<pre class="language-json"><code class="lang-json"><strong>// From Athens airport to Piraeus port request
</strong>{
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
        "google_place_id": "",
        "description": "",
        "lat": null,
        "lng": null,
        "iata_code": null,
        "port_code": "PIR"
    },
    "pickup_date": "2023-10-30",
    "pickup_time": "13:30",
    "passengers": 1,
    "luggage": 1
}
</code></pre>

</details>

<details>

<summary>Example JSON response</summary>

```json
// From Athens airport to Piraeus port response
{
    "data": {
        "id": "yO4EYr1o",
        "type": "quote_requests",
        "attributes": {
            "from_location": {
                "type": "airport",
                "description": "Athens Airport , Athens International Airport, Eleftherios Venizelos",
                "lat": 37.935647,
                "lng": 23.948416
            },
            "to_location": {
                "type": "port",
                "description": "Piraeus Port - Cruise Terminal",
                "lat": 37.940556,
                "lng": 23.633333
            },
            "from_date": "2023-10-30",
            "from_time": "13:30",
            "number_of_passengers": 1,
            "number_of_luggage": 1,
            "created_at": "2023-10-24T12:35:15+03:00",
            "count_of_total_quotes_returned": 1
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "LJrR0WJR",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "LJrR0WJR",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "yO4EYr1o",
                "status": "price-confirmed",
                "operator": "welcome",
                "expires_at": "2023-10-24T12:50:15+03:00",
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
                    "price": 54.0,
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

</details>

### Utilizing the [Hubs](/api-docs/reference/api-reference/hubs.md) endpoint to get a quote

Another way to successfully get back a quote while having a from or to location as a Hub (Airport, Port, Train station), is to list the hub needed in the hubs endpoint and use it's resolved id in the create quote request endpoint.

#### Listing the Athens airport in the hubs endpoint

Send a GET request to `{{api_host}}/v1/external/hubs?kind=airport&city_id=jEMPGz5b`

Where is `jEMPGz5b` is the city id of Athens retrieved from the [list cities endpoint](/api-docs/reference/api-reference/cities/list-cities.md).

<details>

<summary>Example JSON response</summary>

```json
{
    "data": [
        {
            "id": "jQZyXGEw",
            "type": "hubs",
            "attributes": {
                "kind": "Airport",
                "iata_code": "ATH",
                "port_code": null,
                "name": "Athens Airport ",
                "country_code": "GR",
                "country_id": "OdP14zRb",
                "city_id": "jEMPGz5b",
                "lat": "37.935647",
                "lng": "23.948416",
                "google_place_id": "ChIJYVzn2RqQoRQRqrPuCt8Vsjg",
                "address": "Athens International Airport, Eleftherios Venizelos"
            }
        }
    ],
    "links": {
        "self": "/v1/external/hubs?city_id=jEMPGz5b&kind=airport&page%5Bnumber%5D=1&page%5Bsize%5D=25",
        "first": "/v1/external/hubs?city_id=jEMPGz5b&kind=airport&page%5Bnumber%5D=1&page%5Bsize%5D=25",
        "prev": null,
        "next": null,
        "last": "/v1/external/hubs?city_id=jEMPGz5b&kind=airport&page%5Bnumber%5D=1&page%5Bsize%5D=25"
    },
    "meta": {
        "pagination": {
            "total_item_count": 1,
            "filtered_item_count": 1,
            "current_page": 1,
            "total_pages": 1,
            "per_page": 25,
            "next_page": null,
            "previous_page": null
        }
    }
}
```

</details>

#### Utilizing the retrieved location id of the Athens airport from the Hubs endpoint

We have the `jQZyXGEw` to be the location id of the Athens airport.

<details>

<summary>Example JSON payload</summary>

<pre class="language-json"><code class="lang-json"><strong>// From Athens airport to Piraeus port request
</strong>{
    "from_location": {
        "id": "jQZyXGEw",
        "google_place_id": "",
        "description": "",
        "lat": null,
        "lng": null,
        "iata_code": null,
        "port_code": null
    },
    "to_location": {
        "id": "eQGPD1GE",
        "google_place_id": "",
        "description": "",
        "lat": null,
        "lng": null,
        "iata_code": null,
        "port_code": null
    },
    "pickup_date": "2023-10-30",
    "pickup_time": "13:30",
    "passengers": 1,
    "luggage": 1
}
</code></pre>

</details>

<details>

<summary>Example JSON response</summary>

```json
// From Athens airport to Piraeus port response
{
    "data": {
        "id": "Nm0EYgZR",
        "type": "quote_requests",
        "attributes": {
            "from_location": {
                "type": "airport",
                "description": "Athens Airport , Athens International Airport, Eleftherios Venizelos",
                "lat": 37.935647,
                "lng": 23.948416
            },
            "to_location": {
                "type": "port",
                "description": "Piraeus Port - Cruise Terminal",
                "lat": 37.940556,
                "lng": 23.633333
            },
            "from_date": "2023-10-30",
            "from_time": "13:30",
            "number_of_passengers": 1,
            "number_of_luggage": 1,
            "created_at": "2023-10-24T12:53:19+03:00",
            "count_of_total_quotes_returned": 1
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "0JPGRqlo",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "0JPGRqlo",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "Nm0EYgZR",
                "status": "price-confirmed",
                "operator": "welcome",
                "expires_at": "2023-10-24T13:08:19+03:00",
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
                    "price": 54.0,
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

</details>

### Utilizing google place id

In the [create quote request endpoint](/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md), **google place id** **along** with the triplet of (lat, lng, description) can also be utilized with the aim of resolving a location and getting a quote back.

<details>

<summary>Example JSON payload</summary>

<pre class="language-json"><code class="lang-json"><strong>// From Athens airport to Piraeus port request
</strong>{
    "from_location": {
        "id": "",
        "google_place_id": "ChIJYVzn2RqQoRQRqrPuCt8Vsjg",
        "description": "Athens Airport , Athens International Airport, Eleftherios Venizelos",
        "lat": 37.935647,
        "lng": 23.948416,
        "iata_code": null,
        "port_code": null
    },
    "to_location": {
        "id": "",
        "google_place_id": "ChIJz_CMiNW7oRQRQxs5soT_xvw",
        "description": "",
        "lat": 37.940556,
        "lng": 23.633333,
        "iata_code": null,
        "port_code": null
    },
    "pickup_date": "2023-10-30",
    "pickup_time": "13:30",
    "passengers": 1,
    "luggage": 1
}
</code></pre>

</details>

<details>

<summary>Example JSON response</summary>

```json
// From Athens airport to Piraeus port response
{
    "data": {
        "id": "WZKqk21E",
        "type": "quote_requests",
        "attributes": {
            "from_location": {
                "type": "airport",
                "description": "Athens Airport , Athens International Airport, Eleftherios Venizelos",
                "lat": 37.935647,
                "lng": 23.948416
            },
            "to_location": {
                "type": "port",
                "description": "Piraeus Port - Cruise Terminal",
                "lat": 37.940556,
                "lng": 23.633333
            },
            "from_date": "2023-10-30",
            "from_time": "13:30",
            "number_of_passengers": 1,
            "number_of_luggage": 1,
            "created_at": "2023-10-24T14:58:37+03:00",
            "count_of_total_quotes_returned": 1
        },
        "relationships": {
            "quotes": {
                "data": [
                    {
                        "id": "bzp4R4zL",
                        "type": "quotes"
                    }
                ]
            }
        }
    },
    "included": [
        {
            "id": "bzp4R4zL",
            "type": "quotes",
            "attributes": {
                "quote_request_id": "WZKqk21E",
                "status": "price-confirmed",
                "operator": "welcome",
                "expires_at": "2023-10-24T15:13:37+03:00",
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
                    "price": 54.0,
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

</details>
