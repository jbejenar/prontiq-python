# Suggestions

## Example Usage

```typescript
import { Suggestions } from "@prontiq/sdk/models/operations";

let value: Suggestions = {
  id: "<id>",
};
```

## Fields

| Field                                  | Type                                   | Required                               | Description                            |
| -------------------------------------- | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| `id`                                   | *string*                               | :heavy_check_mark:                     | G-NAF persistent identifier.           |
| `addressLabel`                         | *string*                               | :heavy_minus_sign:                     | Street address (number + street name). |
| `localityName`                         | *string*                               | :heavy_minus_sign:                     | Suburb or locality name.               |
| `state`                                | *string*                               | :heavy_minus_sign:                     | Australian state code.                 |
| `postcode`                             | *string*                               | :heavy_minus_sign:                     | 4-digit Australian postcode.           |
| `confidence`                           | *number*                               | :heavy_minus_sign:                     | G-NAF confidence level (0-2).          |
| `score`                                | *number*                               | :heavy_minus_sign:                     | Search relevance score.                |