<!-- Start SDK Example Usage [usage] -->
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressAutocomplete("<value>");

  console.log(result);
}

run();

```
<!-- End SDK Example Usage [usage] -->