# GetV1AddressEnrichResponse

## Example Usage

```typescript
import { GetV1AddressEnrichResponse } from "@prontiq/sdk/models/operations";

let value: GetV1AddressEnrichResponse = {
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
    id: "<id>",
  },
};
```

## Fields

| Field                                                                                                       | Type                                                                                                        | Required                                                                                                    | Description                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `headers`                                                                                                   | Record<string, *string*[]>                                                                                  | :heavy_check_mark:                                                                                          | N/A                                                                                                         |
| `result`                                                                                                    | [operations.GetV1AddressEnrichResponseBody](../../models/operations/get-v1-address-enrich-response-body.md) | :heavy_check_mark:                                                                                          | N/A                                                                                                         |