# GetV1AddressValidateGeocode

Physical location and geocoding metadata.

## Example Usage

```typescript
import { GetV1AddressValidateGeocode } from "@prontiq/sdk/models/operations";

let value: GetV1AddressValidateGeocode = {
  latitude: 6049.67,
  longitude: 8790.14,
};
```

## Fields

| Field                                             | Type                                              | Required                                          | Description                                       |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `latitude`                                        | *number*                                          | :heavy_check_mark:                                | Latitude in decimal degrees.                      |
| `longitude`                                       | *number*                                          | :heavy_check_mark:                                | Longitude in decimal degrees.                     |
| `type`                                            | *string*                                          | :heavy_minus_sign:                                | Geocoding method, e.g. PROPERTY CENTROID.         |
| `reliability`                                     | *number*                                          | :heavy_minus_sign:                                | G-NAF geocode reliability (0-6, lower is better). |