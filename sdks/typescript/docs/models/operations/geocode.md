# Geocode

Physical location and geocoding metadata.

## Example Usage

```typescript
import { Geocode } from "@prontiq/sdk/models/operations";

let value: Geocode = {
  latitude: 341.52,
  longitude: 5622.42,
};
```

## Fields

| Field                                             | Type                                              | Required                                          | Description                                       |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `latitude`                                        | *number*                                          | :heavy_check_mark:                                | Latitude in decimal degrees.                      |
| `longitude`                                       | *number*                                          | :heavy_check_mark:                                | Longitude in decimal degrees.                     |
| `type`                                            | *string*                                          | :heavy_minus_sign:                                | Geocoding method, e.g. PROPERTY CENTROID.         |
| `reliability`                                     | *number*                                          | :heavy_minus_sign:                                | G-NAF geocode reliability (0-6, lower is better). |