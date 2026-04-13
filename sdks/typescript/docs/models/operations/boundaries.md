# Boundaries

Electoral, administrative, and statistical boundaries.

## Example Usage

```typescript
import { Boundaries } from "@prontiq/sdk/models/operations";

let value: Boundaries = {};
```

## Fields

| Field                                                                                   | Type                                                                                    | Required                                                                                | Description                                                                             |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `lga`                                                                                   | [operations.Lga](../../models/operations/lga.md)                                        | :heavy_minus_sign:                                                                      | Local Government Area.                                                                  |
| `stateElectorate`                                                                       | [operations.StateElectorate](../../models/operations/state-electorate.md)               | :heavy_minus_sign:                                                                      | State electoral district.                                                               |
| `commonwealthElectorate`                                                                | [operations.CommonwealthElectorate](../../models/operations/commonwealth-electorate.md) | :heavy_minus_sign:                                                                      | Federal electoral district.                                                             |
| `meshBlock`                                                                             | [operations.MeshBlock](../../models/operations/mesh-block.md)                           | :heavy_minus_sign:                                                                      | ABS smallest geographic unit.                                                           |
| `sa2`                                                                                   | [operations.Sa2](../../models/operations/sa2.md)                                        | :heavy_minus_sign:                                                                      | Statistical Area Level 2.                                                               |
| `sa3`                                                                                   | [operations.Sa3](../../models/operations/sa3.md)                                        | :heavy_minus_sign:                                                                      | Statistical Area Level 3.                                                               |
| `sa4`                                                                                   | [operations.Sa4](../../models/operations/sa4.md)                                        | :heavy_minus_sign:                                                                      | Statistical Area Level 4.                                                               |
| `gccsa`                                                                                 | [operations.Gccsa](../../models/operations/gccsa.md)                                    | :heavy_minus_sign:                                                                      | Greater Capital City Statistical Area.                                                  |