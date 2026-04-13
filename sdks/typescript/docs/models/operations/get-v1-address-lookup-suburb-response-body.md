# GetV1AddressLookupSuburbResponseBody

Suburb postcode summary

## Example Usage

```typescript
import { GetV1AddressLookupSuburbResponseBody } from "@prontiq/sdk/models/operations";

let value: GetV1AddressLookupSuburbResponseBody = {
  suburb: "<value>",
  postcodes: [
    "<value 1>",
    "<value 2>",
  ],
  addressCount: 808577,
};
```

## Fields

| Field                                                  | Type                                                   | Required                                               | Description                                            |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| `suburb`                                               | *string*                                               | :heavy_check_mark:                                     | Normalised suburb name (uppercase).                    |
| `state`                                                | *string*                                               | :heavy_minus_sign:                                     | State filter applied, if any.                          |
| `postcodes`                                            | *string*[]                                             | :heavy_check_mark:                                     | Postcodes covering this suburb.                        |
| `bounds`                                               | [operations.Bounds](../../models/operations/bounds.md) | :heavy_minus_sign:                                     | Geographic bounding box of the suburb.                 |
| `addressCount`                                         | *number*                                               | :heavy_check_mark:                                     | Total addresses in this suburb.                        |