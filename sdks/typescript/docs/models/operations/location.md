# Location

OpenSearch geo_point format.

## Example Usage

```typescript
import { Location } from "@prontiq/sdk/models/operations";

let value: Location = {
  lat: 8282.86,
  lon: 2944.81,
};
```

## Fields

| Field              | Type               | Required           | Description        |
| ------------------ | ------------------ | ------------------ | ------------------ |
| `lat`              | *number*           | :heavy_check_mark: | Latitude.          |
| `lon`              | *number*           | :heavy_check_mark: | Longitude.         |