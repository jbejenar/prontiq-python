# GetV1AddressLookupPostcodeResponseBody

Postcode locality summary

## Example Usage

```typescript
import { GetV1AddressLookupPostcodeResponseBody } from "@prontiq/sdk/models/operations";

let value: GetV1AddressLookupPostcodeResponseBody = {
  postcode: "92685-9127",
  localities: [],
};
```

## Fields

| Field                                                            | Type                                                             | Required                                                         | Description                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `postcode`                                                       | *string*                                                         | :heavy_check_mark:                                               | The queried postcode.                                            |
| `localities`                                                     | [operations.Localities](../../models/operations/localities.md)[] | :heavy_check_mark:                                               | N/A                                                              |