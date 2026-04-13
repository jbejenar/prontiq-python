# Localities

## Example Usage

```typescript
import { Localities } from "@prontiq/sdk/models/operations";

let value: Localities = {
  name: "<value>",
  addressCount: 584989,
};
```

## Fields

| Field                                 | Type                                  | Required                              | Description                           |
| ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| `name`                                | *string*                              | :heavy_check_mark:                    | Locality/suburb name.                 |
| `state`                               | *string*                              | :heavy_minus_sign:                    | State code.                           |
| `addressCount`                        | *number*                              | :heavy_check_mark:                    | Number of addresses in this locality. |