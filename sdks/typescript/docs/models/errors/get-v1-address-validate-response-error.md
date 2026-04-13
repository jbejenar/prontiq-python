# GetV1AddressValidateResponseError

## Example Usage

```typescript
import { GetV1AddressValidateResponseError } from "@prontiq/sdk/models/errors";

let value: GetV1AddressValidateResponseError = {
  code: "<value>",
  message: "<value>",
  status: 245178,
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