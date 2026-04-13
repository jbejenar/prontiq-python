# GetV1AddressValidateResponseBody

Best address match

## Example Usage

```typescript
import { GetV1AddressValidateResponseBody } from "@prontiq/sdk/models/operations";

let value: GetV1AddressValidateResponseBody = {
  match: {
    id: "<id>",
  },
  confidence: "low",
};
```

## Fields

| Field                                                                                | Type                                                                                 | Required                                                                             | Description                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `match`                                                                              | [operations.Match](../../models/operations/match.md)                                 | :heavy_check_mark:                                                                   | Best matching address, or null if no match.                                          |
| `confidence`                                                                         | [operations.Confidence](../../models/operations/confidence.md)                       | :heavy_check_mark:                                                                   | Match confidence: high (score > 20), medium (10-20), low (< 10), or none (no match). |