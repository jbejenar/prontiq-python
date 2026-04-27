# GetV1AddressLookupPostcodeResponse

## Example Usage

```typescript
import { GetV1AddressLookupPostcodeResponse } from "@prontiq/sdk/models/operations";

let value: GetV1AddressLookupPostcodeResponse = {
  headers: {
    "key": [
      "<value 1>",
      "<value 2>",
      "<value 3>",
    ],
    "key1": [],
  },
  result: {
    postcode: "18640-4905",
    localities: [],
  },
};
```

## Fields

| Field                                                                                                                        | Type                                                                                                                         | Required                                                                                                                     | Description                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `headers`                                                                                                                    | Record<string, *string*[]>                                                                                                   | :heavy_check_mark:                                                                                                           | N/A                                                                                                                          |
| `result`                                                                                                                     | [operations.GetV1AddressLookupPostcodeResponseBody](../../models/operations/get-v1-address-lookup-postcode-response-body.md) | :heavy_check_mark:                                                                                                           | N/A                                                                                                                          |