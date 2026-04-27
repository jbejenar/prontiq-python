# GetV1AddressLookupSuburbResponse

## Example Usage

```typescript
import { GetV1AddressLookupSuburbResponse } from "@prontiq/sdk/models/operations";

let value: GetV1AddressLookupSuburbResponse = {
  headers: {
    "key": [],
    "key1": [
      "<value 1>",
    ],
    "key2": [],
  },
  result: {
    suburb: "<value>",
    postcodes: [
      "<value 1>",
      "<value 2>",
    ],
    addressCount: 160908,
  },
};
```

## Fields

| Field                                                                                                                    | Type                                                                                                                     | Required                                                                                                                 | Description                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `headers`                                                                                                                | Record<string, *string*[]>                                                                                               | :heavy_check_mark:                                                                                                       | N/A                                                                                                                      |
| `result`                                                                                                                 | [operations.GetV1AddressLookupSuburbResponseBody](../../models/operations/get-v1-address-lookup-suburb-response-body.md) | :heavy_check_mark:                                                                                                       | N/A                                                                                                                      |