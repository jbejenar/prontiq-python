# GetV1AddressReverseRequest

## Example Usage

```typescript
import { GetV1AddressReverseRequest } from "@prontiq/sdk/models/operations";

let value: GetV1AddressReverseRequest = {
  lat: 2727.51,
  lon: 9714.21,
};
```

## Fields

| Field                                         | Type                                          | Required                                      | Description                                   |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `lat`                                         | *number*                                      | :heavy_check_mark:                            | Latitude in decimal degrees.                  |
| `lon`                                         | *number*                                      | :heavy_check_mark:                            | Longitude in decimal degrees.                 |
| `radius`                                      | *number*                                      | :heavy_minus_sign:                            | Search radius in metres.                      |
| `limit`                                       | *number*                                      | :heavy_minus_sign:                            | Maximum number of nearby addresses to return. |