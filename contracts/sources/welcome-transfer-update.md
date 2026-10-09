> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/transfers/transfer-update.md).

# Transfer Update

## Overview

Partners can now update a transfer through a simple, transparent two-step flow:

#### **1. Request the changes**

Send the desired modifications to\ <mark style="color:purple;">`POST`</mark>` ``/v1/external/transfers/{transfer_id}/update_requests`\
Nothing is applied yet — this step only prepares the update.

#### **2. Review & confirm**

We return the full changeset, along with any price difference (additional charge or refund) and a TransferUpdate token.\
This two-step approach ensures the partner or traveler can fully review the impact — especially any cost changes — before deciding whether to proceed.

If they approve, they confirm via:\ <mark style="color:purple;">`POST`</mark>` ``/v1/external/transfers/{transfer_id}/update_requests/{update_request_id}/confirm`

The update is applied **only after confirmation**.

## Technical documentation

### **Request the changes**

<mark style="color:purple;">`POST`</mark>` ``/v1/external/transfers/{transfer_id}/update_requests`

#### Path Parameters

| Name                                           | Type   | Description                                             |
| ---------------------------------------------- | ------ | ------------------------------------------------------- |
| transfer\_id<mark style="color:red;">\*</mark> | String | <p>The id of a transfer.<br>Required url parameter.</p> |

#### Query Parameters

| Name                                       | Type   | Description                          |
| ------------------------------------------ | ------ | ------------------------------------ |
| api\_key<mark style="color:red;">\*</mark> | String | The access key for making API calls. |

#### Headers

| Name          | Type   | Description                                                                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | String | <p>Authorization token can be used instead of the <strong>api\_key</strong> url parameter.</p><p></p><p>e.g. Authorization: Bearer token</p> |

#### Request Body

<table><thead><tr><th width="287">Name</th><th width="110">Type</th><th>Description</th></tr></thead><tbody><tr><td>from_location<mark style="color:red;">*</mark></td><td>Hash</td><td>From location object</td></tr><tr><td>from_location[id]</td><td>String</td><td>Id of <a href="/api-docs/reference/api-reference/hubs.md#hub">Hub</a></td></tr><tr><td>from_location[google_place_id]</td><td>String</td><td>Google place id</td></tr><tr><td>from_location[iata_code]</td><td>String</td><td>IATA code</td></tr><tr><td>from_location[port_code]</td><td>String</td><td>Port code</td></tr><tr><td>from_location[description]</td><td>String</td><td>Precise transfer pickup location description as a string</td></tr><tr><td>from_location[lat]</td><td>Double</td><td>Precise transfer pickup location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td>Precise transfer pickup location longitude</td></tr><tr><td>to_location<mark style="color:red;">*</mark></td><td>Hash</td><td>To location object</td></tr><tr><td>to_location[id]</td><td>String</td><td>Id of <a href="/api-docs/reference/api-reference/hubs.md#hub">Hub</a></td></tr><tr><td>to_location[google_place_id]</td><td>String</td><td>Google place id</td></tr><tr><td>to_location[iata_code]</td><td>String</td><td>IATA code</td></tr><tr><td>to_location[port_code]</td><td>String</td><td>Port code</td></tr><tr><td>to_location[description]</td><td>String</td><td>Precise transfer drop-off location description as a string</td></tr><tr><td>to_location[lat]</td><td>Double</td><td>Precise transfer drop-off location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td>Precise transfer drop-off location longitude</td></tr><tr><td>pickup_date<mark style="color:red;">*</mark></td><td>String</td><td>Pickup date<br>(Format: ISO8601 yyyy-MM-dd (date) e.g. "2023-06-25")</td></tr><tr><td>pickup_time<mark style="color:red;">*</mark></td><td>String</td><td>Pickup time<br>(Format: HH:mm e.g. "09:50")</td></tr><tr><td>passengers<mark style="color:red;">*</mark></td><td>Integer</td><td>Number of passengers</td></tr><tr><td>checked_luggage_quantity</td><td>Integer</td><td>Number of checked luggage</td></tr><tr><td>hand_luggage_quantity</td><td>Integer</td><td>Number of hand luggage</td></tr><tr><td>infant_seats</td><td>Integer</td><td>Number of infant seats<br><br>(Infant seat is for babies 0 - 6 months old)</td></tr><tr><td>child_seats</td><td>Integer</td><td>Number of child seats<br><br>(Child seat is for children 6 months - 3 years old)</td></tr><tr><td>booster_seats</td><td>Integer</td><td>Number of booster seats<br><br>(Booster seat is for children 3 - 12 years old)</td></tr><tr><td>additional_notes</td><td>String</td><td>Any additional information you would like to communicate to your transport service provider.</td></tr><tr><td>transport_designator</td><td>String</td><td>Transport designator can be a flight number, a ferry name or a train station name.</td></tr></tbody></table>

#### Notes

* To change a location, the `description/lng/lat` triplet is required with the `google_place_id` being an optional supplementary parameter to the triplet.\
  You can choose to search by `iata_code`, `port_code` and `id` as long as you also provide the triplet mentioned above. You can even put dummy data for the triplet if you choose to use `iata_code`, `port_code` or `id`.  E.g. use `{"to_location":{"iata_code":"LGW","description":"-","lat":-1,"lng":-1}}`for the London Gatwick Airport.
* For the `Transfer Update` module, changing the location to a different city is only possible for selected locations: mainly airport/port hubs or other central locations.\
  If the location is in a different city and not a common location (e.g. an airport), you might get the error `No such address in currently selected` at the `Confirm` step (see below).

#### Request example

{% code lineNumbers="true" %}

```json
{
  "transfer_id": "6p1aGlNre8qv",
  "from_location": {
    "iata_code": "ATH"
  },
  "to_location": {
    "description": "Rafina Port (fleet base)",
    "lat": 24.0071482,
    "lng": 38.0247799
  },
  "pickup_date": "2026-01-15",
  "pickup_time": "09:20",
  "passengers": 2,
  "checked_luggage_quantity": 1,
  "hand_luggage_quantity": 0,
  "infant_seats": 4,
  "child_seats": 1,
  "booster_seats": 2,
  "additional_notes": "note",
  "transport_designator": "A134"
}

```

{% endcode %}

#### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>String</td><td>Required</td><td>Transfer Update token. Can be used on the next step to confirm the changes</td></tr><tr><td>attributes</td><td>Hash</td><td>Required</td><td>Contains the changeset and payment data</td></tr><tr><td>attributes[changeset]</td><td>Hash</td><td>Required</td><td>Displays every modified field with its old and new values for review.</td></tr><tr><td>attributes[payment]</td><td>Hash</td><td>Optional</td><td>Payment information related to the update (if any).</td></tr><tr><td>attributes[payment][type]</td><td>String</td><td>Required</td><td>Indicates whether the update results in a <strong>charge</strong> or a <strong>refund</strong>.</td></tr><tr><td>attributes[payment][total_amount]</td><td>Float</td><td>Required</td><td>The amount to be charged or refunded.</td></tr></tbody></table>

#### Response Example

{% tabs %}
{% tab title="201: Transfer Update is successfully created" %}

<pre class="language-json"><code class="lang-json"><strong>{
</strong>  "data": {
    "id": "QnW1ooY2",
    "type": "transfer_updates",
<strong>    "attributes": {
</strong>      "changeset": {
        "pickup_date": {
          "old_value": "2025-12-28",
          "new_value": "2026-01-15"
        },
        "pickup_time": {
          "old_value": "09:52",
          "new_value": "09:20"
        },
        "to_location": {
          "old_value": {
            "token": "LGkvooOR"
          },
          "new_value": {
            "description": "Rafina Port (fleet base)",
            "lat": 24.0071482,
            "lng": 38.0247799,
            "title": "Rafina Port (fleet base)",
            "full_address": "Rafina Port",
            "token": "qwoQggJE"
          }
        },
        "transport_designator": {
          "old_value": "A133",
          "new_value": "A134"
        },
        "number_of_luggage": {
          "old_value": 2,
          "new_value": 1
        },
        "hand_luggage_quantity": {
          "old_value": 1,
          "new_value": 0
        },
        "additional_notes": {
          "old_value": "old note",
          "new_value": "note"
        },
        "infant_carrier": {
          "new_value": 4
        },
        "child_seat": {
          "new_value": 1
        },
        "baby_booster": {
          "new_value": 2
        }
      },
      "payment": {
        "type": "charge",
        "total_amount": 100
      }
    }
  }
}
</code></pre>

{% endtab %}

{% tab title="400: Bad Request Ride operator does not support update" %}

```json
{
  "errors": [
    {
      "status": "400",
      "code": "bad_request",
      "title": "Bad request",
      "detail": [
        "Number of passengers is too high"
      ]
    }
  ]
}
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
      "detail": "Transfer not found"
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

### Confirm

<mark style="color:purple;">`POST`</mark>` ``/v1/external/transfers/{transfer_id}/update_requests/{update_request_id}/confirm`

#### Path Parameters

| Name                                           | Type   | Description                                                         |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------- |
| transfer\_id<mark style="color:red;">\*</mark> | String | <p>The id of a transfer.<br>Required url parameter.</p>             |
| transfer\_update\_id                           | String | <p>The token of the transfer update.<br>Required url parameter.</p> |

#### Query Parameters

| Name                                       | Type   | Description                          |
| ------------------------------------------ | ------ | ------------------------------------ |
| api\_key<mark style="color:red;">\*</mark> | String | The access key for making API calls. |

#### Headers

| Name          | Type   | Description                                                                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | String | <p>Authorization token can be used instead of the <strong>api\_key</strong> url parameter.</p><p></p><p>e.g. Authorization: Bearer token</p> |

#### Response

The response is the same as the "Request the changes" endpoint

{% tabs %}
{% tab title="201: Transfer Update is successfully created" %}

```json
{
  "data": {
    "id": "JbWLMawQ",
    "type": "transfer_updates",
    "attributes": {
      "changeset": {
        "pickup_date": {
          "new_value": "2026-01-15",
          "old_value": "2025-12-28"
        },
        "pickup_time": {
          "new_value": "09:20",
          "old_value": "09:52"
        },
        "to_location": {
          "new_value": {
            "title": "Athens Airport",
            "iata_code": "ATH",
            "full_address": "Athens International Airport, Eleftherios Venizelos",
            "token": "ZBAB6JMz"
          },
          "old_value": {
            "token": "LGkvooOR"
          }
        },
        "additional_notes": {
          "new_value": "note",
          "old_value": "old note"
        },
        "transport_designator": {
          "new_value": "A134",
          "old_value": "A135"
        },
        "infant_carrier": {
          "new_value": 0
        },
        "child_seat": {
          "new_value": 0
        },
        "baby_booster": {
          "new_value": 0
        }
      },
      "payment": {
        "type": "refund",
        "total_amount": 94
      }
    }
  }
}
```

{% endtab %}

{% tab title="400: Bad Request" %}

```
{
  "errors": [
    {
      "status": "400",
      "code": "bad_request",
      "title": "Bad request",
      "detail": {
        "errors": [
          "Update is deprecated by a more recent accepted update with payment data"
        ]
      }
    }
  ]
}
```

{% endtab %}

{% tab title="400: Bad Request" %}

```
{
  "errors": [
    {
      "status": "400",
      "code": "bad_request",
      "title": "Bad request",
      "detail": {
        "errors": [
          "Update already accepted"
        ]
      }
    }
  ]
}
```

{% endtab %}

{% tab title="404: Not Found" %}

```
{
  "errors": [
    {
      "status": "404",
      "code": "not_found",
      "title": "Resource not found",
      "detail": "Transfer not found"
    }
  ]
}
```

{% endtab %}

{% tab title="500: internal server error" %}

{% endtab %}
{% endtabs %}
