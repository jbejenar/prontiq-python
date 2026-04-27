# GetV1AddressReverseResponse

## Example Usage

```typescript
import { GetV1AddressReverseResponse } from "@prontiq/sdk/models/operations";

let value: GetV1AddressReverseResponse = {
  headers: {
    "key": [
      "<value 1>",
      "<value 2>",
      "<value 3>",
    ],
    "key1": [
      "<value 1>",
      "<value 2>",
      "<value 3>",
    ],
  },
  result: {
    results: [],
    total: 98213,
  },
};
```

## Fields

| Field                                                                                                         | Type                                                                                                          | Required                                                                                                      | Description                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `headers`                                                                                                     | Record<string, *string*[]>                                                                                    | :heavy_check_mark:                                                                                            | N/A                                                                                                           |
| `result`                                                                                                      | [operations.GetV1AddressReverseResponseBody](../../models/operations/get-v1-address-reverse-response-body.md) | :heavy_check_mark:                                                                                            | N/A                                                                                                           |