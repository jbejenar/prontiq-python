# GetV1AddressAutocompleteResponseBody

Address suggestions

## Example Usage

```typescript
import { GetV1AddressAutocompleteResponseBody } from "@prontiq/sdk/models/operations";

let value: GetV1AddressAutocompleteResponseBody = {
  suggestions: [
    {
      id: "<id>",
    },
  ],
  total: 957806,
};
```

## Fields

| Field                                                              | Type                                                               | Required                                                           | Description                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `suggestions`                                                      | [operations.Suggestions](../../models/operations/suggestions.md)[] | :heavy_check_mark:                                                 | N/A                                                                |
| `total`                                                            | *number*                                                           | :heavy_check_mark:                                                 | Total matching addresses.                                          |