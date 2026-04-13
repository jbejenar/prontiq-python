# MeshBlock

ABS smallest geographic unit.

## Example Usage

```typescript
import { MeshBlock } from "@prontiq/sdk/models/operations";

let value: MeshBlock = {
  code: "<value>",
};
```

## Fields

| Field                                            | Type                                             | Required                                         | Description                                      |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `code`                                           | *string*                                         | :heavy_check_mark:                               | ABS mesh block code.                             |
| `category`                                       | *string*                                         | :heavy_minus_sign:                               | Land use category, e.g. Residential, Commercial. |