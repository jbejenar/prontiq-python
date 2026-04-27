# GetV1AddressAutocompleteResponse

## Example Usage

```typescript
import { GetV1AddressAutocompleteResponse } from "@prontiq/sdk/models/operations";

let value: GetV1AddressAutocompleteResponse = {
  headers: {
    "key": [
      "<value 1>",
      "<value 2>",
    ],
    "key1": [],
  },
  result: {
    suggestions: [],
    total: 600085,
  },
};
```

## Fields

| Field                                                                                                                   | Type                                                                                                                    | Required                                                                                                                | Description                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `headers`                                                                                                               | Record<string, *string*[]>                                                                                              | :heavy_check_mark:                                                                                                      | N/A                                                                                                                     |
| `result`                                                                                                                | [operations.GetV1AddressAutocompleteResponseBody](../../models/operations/get-v1-address-autocomplete-response-body.md) | :heavy_check_mark:                                                                                                      | N/A                                                                                                                     |