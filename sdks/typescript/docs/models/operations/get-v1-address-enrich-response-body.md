# GetV1AddressEnrichResponseBody

Enriched address document

## Example Usage

```typescript
import { GetV1AddressEnrichResponseBody } from "@prontiq/sdk/models/operations";

let value: GetV1AddressEnrichResponseBody = {
  id: "<id>",
};
```

## Fields

| Field                                                          | Type                                                           | Required                                                       | Description                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `id`                                                           | *string*                                                       | :heavy_check_mark:                                             | G-NAF persistent identifier.                                   |
| `addressLabel`                                                 | *string*                                                       | :heavy_minus_sign:                                             | Street address (number + street name).                         |
| `localityName`                                                 | *string*                                                       | :heavy_minus_sign:                                             | Suburb or locality name.                                       |
| `state`                                                        | *string*                                                       | :heavy_minus_sign:                                             | Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT).   |
| `postcode`                                                     | *string*                                                       | :heavy_minus_sign:                                             | 4-digit Australian postcode.                                   |
| `confidence`                                                   | *number*                                                       | :heavy_minus_sign:                                             | G-NAF confidence level (0-2).                                  |
| `geocode`                                                      | [operations.Geocode](../../models/operations/geocode.md)       | :heavy_minus_sign:                                             | Physical location and geocoding metadata.                      |
| `location`                                                     | [operations.Location](../../models/operations/location.md)     | :heavy_minus_sign:                                             | OpenSearch geo_point format.                                   |
| `boundaries`                                                   | [operations.Boundaries](../../models/operations/boundaries.md) | :heavy_minus_sign:                                             | Electoral, administrative, and statistical boundaries.         |