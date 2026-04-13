# Bounds

Geographic bounding box of the suburb.

## Example Usage

```typescript
import { Bounds } from "@prontiq/sdk/models/operations";

let value: Bounds = {
  topLeft: {
    lat: 3089.99,
    lon: 9693.6,
  },
  bottomRight: {
    lat: 1643.95,
    lon: 8679.34,
  },
};
```

## Fields

| Field                                                             | Type                                                              | Required                                                          | Description                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `topLeft`                                                         | [operations.TopLeft](../../models/operations/top-left.md)         | :heavy_check_mark:                                                | North-west corner of bounding box.                                |
| `bottomRight`                                                     | [operations.BottomRight](../../models/operations/bottom-right.md) | :heavy_check_mark:                                                | South-east corner of bounding box.                                |