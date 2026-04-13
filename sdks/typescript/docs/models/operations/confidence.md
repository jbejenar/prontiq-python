# Confidence

Match confidence: high (score > 20), medium (10-20), low (< 10), or none (no match).

## Example Usage

```typescript
import { Confidence } from "@prontiq/sdk/models/operations";

let value: Confidence = "low";

// Open enum: unrecognized values are captured as Unrecognized<string>
```

## Values

```typescript
"high" | "medium" | "low" | "none" | Unrecognized<string>
```