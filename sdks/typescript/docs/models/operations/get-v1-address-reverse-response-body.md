# GetV1AddressReverseResponseBody

Nearby addresses

## Example Usage

```typescript
import { GetV1AddressReverseResponseBody } from "@prontiq/sdk/models/operations";

let value: GetV1AddressReverseResponseBody = {
  results: [
    {
      id: "<id>",
    },
  ],
  total: 948926,
};
```

## Fields

| Field                                                      | Type                                                       | Required                                                   | Description                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `results`                                                  | [operations.Results](../../models/operations/results.md)[] | :heavy_check_mark:                                         | N/A                                                        |
| `total`                                                    | *number*                                                   | :heavy_check_mark:                                         | Total addresses within radius.                             |