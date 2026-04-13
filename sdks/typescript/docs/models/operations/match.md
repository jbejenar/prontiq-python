# Match

Best matching address, or null if no match.

## Example Usage

```typescript
import { Match } from "@prontiq/sdk/models/operations";

let value: Match = {
  id: "<id>",
};
```

## Fields

| Field                                                                                                      | Type                                                                                                       | Required                                                                                                   | Description                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                       | *string*                                                                                                   | :heavy_check_mark:                                                                                         | G-NAF persistent identifier.                                                                               |
| `addressLabel`                                                                                             | *string*                                                                                                   | :heavy_minus_sign:                                                                                         | Street address (number + street name).                                                                     |
| `localityName`                                                                                             | *string*                                                                                                   | :heavy_minus_sign:                                                                                         | Suburb or locality name.                                                                                   |
| `state`                                                                                                    | *string*                                                                                                   | :heavy_minus_sign:                                                                                         | Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT).                                               |
| `postcode`                                                                                                 | *string*                                                                                                   | :heavy_minus_sign:                                                                                         | 4-digit Australian postcode.                                                                               |
| `confidence`                                                                                               | *number*                                                                                                   | :heavy_minus_sign:                                                                                         | G-NAF confidence level (0-2).                                                                              |
| `geocode`                                                                                                  | [operations.GetV1AddressValidateGeocode](../../models/operations/get-v1-address-validate-geocode.md)       | :heavy_minus_sign:                                                                                         | Physical location and geocoding metadata.                                                                  |
| `location`                                                                                                 | [operations.GetV1AddressValidateLocation](../../models/operations/get-v1-address-validate-location.md)     | :heavy_minus_sign:                                                                                         | OpenSearch geo_point format.                                                                               |
| `boundaries`                                                                                               | [operations.GetV1AddressValidateBoundaries](../../models/operations/get-v1-address-validate-boundaries.md) | :heavy_minus_sign:                                                                                         | Electoral, administrative, and statistical boundaries.                                                     |