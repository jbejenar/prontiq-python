# GetV1AddressEnrichError

## Example Usage

```typescript
import { GetV1AddressEnrichError } from "@prontiq/sdk/models/errors";

let value: GetV1AddressEnrichError = {
  code: "<value>",
  message: "<value>",
  status: 415408,
  requestId: "<id>",
};
```

## Fields

| Field                 | Type                  | Required              | Description           |
| --------------------- | --------------------- | --------------------- | --------------------- |
| `code`                | *string*              | :heavy_check_mark:    | N/A                   |
| `message`             | *string*              | :heavy_check_mark:    | N/A                   |
| `status`              | *number*              | :heavy_check_mark:    | N/A                   |
| `requestId`           | *string*              | :heavy_check_mark:    | N/A                   |
| `details`             | Record<string, *any*> | :heavy_minus_sign:    | N/A                   |