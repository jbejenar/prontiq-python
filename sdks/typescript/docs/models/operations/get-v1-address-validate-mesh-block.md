# GetV1AddressValidateMeshBlock

ABS smallest geographic unit.

## Example Usage

```typescript
import { GetV1AddressValidateMeshBlock } from "@prontiq/sdk/models/operations";

let value: GetV1AddressValidateMeshBlock = {
  code: "<value>",
};
```

## Fields

| Field                                            | Type                                             | Required                                         | Description                                      |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `code`                                           | *string*                                         | :heavy_check_mark:                               | ABS mesh block code.                             |
| `category`                                       | *string*                                         | :heavy_minus_sign:                               | Land use category, e.g. Residential, Commercial. |