# GetV1AddressValidateResponse

## Example Usage

```typescript
import { GetV1AddressValidateResponse } from "@prontiq/sdk/models/operations";

let value: GetV1AddressValidateResponse = {
  headers: {},
  result: {
    match: {
      id: "<id>",
    },
    confidence: "high",
  },
};
```

## Fields

| Field                                                                                                           | Type                                                                                                            | Required                                                                                                        | Description                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `headers`                                                                                                       | Record<string, *string*[]>                                                                                      | :heavy_check_mark:                                                                                              | N/A                                                                                                             |
| `result`                                                                                                        | [operations.GetV1AddressValidateResponseBody](../../models/operations/get-v1-address-validate-response-body.md) | :heavy_check_mark:                                                                                              | N/A                                                                                                             |