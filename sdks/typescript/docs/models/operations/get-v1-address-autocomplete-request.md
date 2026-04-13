# GetV1AddressAutocompleteRequest

## Example Usage

```typescript
import { GetV1AddressAutocompleteRequest } from "@prontiq/sdk/models/operations";

let value: GetV1AddressAutocompleteRequest = {
  q: "<value>",
};
```

## Fields

| Field                                    | Type                                     | Required                                 | Description                              |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `q`                                      | *string*                                 | :heavy_check_mark:                       | Partial address query.                   |
| `state`                                  | *string*                                 | :heavy_minus_sign:                       | Australian state code.                   |
| `limit`                                  | *number*                                 | :heavy_minus_sign:                       | Maximum number of suggestions to return. |