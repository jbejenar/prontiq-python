# ErrorT

## Example Usage

```typescript
import { ErrorT } from "@prontiq/sdk/models/errors";

let value: ErrorT = {
  code: "<value>",
  message: "<value>",
  status: 81384,
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