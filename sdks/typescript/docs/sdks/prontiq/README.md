# Prontiq SDK

## Overview

Prontiq API: Unified API for Australian and global open data products.

### Available Operations

* [getV1AddressAutocomplete](#getv1addressautocomplete) - Autocomplete addresses
* [getV1AddressValidate](#getv1addressvalidate) - Validate an address
* [getV1AddressEnrich](#getv1addressenrich) - Enrich an address by ID
* [getV1AddressReverse](#getv1addressreverse) - Reverse geocode nearby addresses
* [getV1AddressLookupPostcode](#getv1addresslookuppostcode) - Look up localities by postcode
* [getV1AddressLookupSuburb](#getv1addresslookupsuburb) - Look up postcodes by suburb

## getV1AddressAutocomplete

Autocomplete addresses

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/v1/address/autocomplete" method="get" path="/v1/address/autocomplete" -->
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

### Standalone function

The standalone function version of this method:

```typescript
import { ProntiqCore } from "@prontiq/sdk/core.js";
import { getV1AddressAutocomplete } from "@prontiq/sdk/funcs/get-v1-address-autocomplete.js";

// Use `ProntiqCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const prontiq = new ProntiqCore({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const res = await getV1AddressAutocomplete(prontiq, "<value>");
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("getV1AddressAutocomplete failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`                                                                                                                                                                            | *string*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | Partial address query.                                                                                                                                                         |
| `state`                                                                                                                                                                        | *string*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Australian state code.                                                                                                                                                         |
| `limit`                                                                                                                                                                        | *number*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Maximum number of suggestions to return.                                                                                                                                       |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetV1AddressAutocompleteResponseBody](../../models/operations/get-v1-address-autocomplete-response-body.md)\>**

### Errors

| Error Type                                             | Status Code                                            | Content Type                                           |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| errors.GetV1AddressAutocompleteResponseBody            | 400                                                    | application/json                                       |
| errors.GetV1AddressAutocompleteResponseResponseBody    | 401                                                    | application/json                                       |
| errors.GetV1AddressAutocompleteResponse403ResponseBody | 403                                                    | application/json                                       |
| errors.GetV1AddressAutocompleteResponse429ResponseBody | 429                                                    | application/json                                       |
| errors.GetV1AddressAutocompleteResponse500ResponseBody | 500                                                    | application/json                                       |
| errors.ProntiqDefaultError                             | 4XX, 5XX                                               | \*/\*                                                  |

## getV1AddressValidate

Validate an address

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/v1/address/validate" method="get" path="/v1/address/validate" -->
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressValidate("<value>");

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { ProntiqCore } from "@prontiq/sdk/core.js";
import { getV1AddressValidate } from "@prontiq/sdk/funcs/get-v1-address-validate.js";

// Use `ProntiqCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const prontiq = new ProntiqCore({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const res = await getV1AddressValidate(prontiq, "<value>");
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("getV1AddressValidate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`                                                                                                                                                                            | *string*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | Full address string to validate.                                                                                                                                               |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetV1AddressValidateResponseBody](../../models/operations/get-v1-address-validate-response-body.md)\>**

### Errors

| Error Type                                         | Status Code                                        | Content Type                                       |
| -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| errors.GetV1AddressValidateResponseBody            | 400                                                | application/json                                   |
| errors.GetV1AddressValidateResponseResponseBody    | 401                                                | application/json                                   |
| errors.GetV1AddressValidateResponse403ResponseBody | 403                                                | application/json                                   |
| errors.GetV1AddressValidateResponse429ResponseBody | 429                                                | application/json                                   |
| errors.GetV1AddressValidateResponse500ResponseBody | 500                                                | application/json                                   |
| errors.ProntiqDefaultError                         | 4XX, 5XX                                           | \*/\*                                              |

## getV1AddressEnrich

Enrich an address by ID

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/v1/address/enrich" method="get" path="/v1/address/enrich" -->
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressEnrich("<id>");

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { ProntiqCore } from "@prontiq/sdk/core.js";
import { getV1AddressEnrich } from "@prontiq/sdk/funcs/get-v1-address-enrich.js";

// Use `ProntiqCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const prontiq = new ProntiqCore({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const res = await getV1AddressEnrich(prontiq, "<id>");
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("getV1AddressEnrich failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                                                                                                                                           | *string*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | G-NAF address document ID.                                                                                                                                                     |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetV1AddressEnrichResponseBody](../../models/operations/get-v1-address-enrich-response-body.md)\>**

### Errors

| Error Type                                       | Status Code                                      | Content Type                                     |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| errors.GetV1AddressEnrichResponseBody            | 400                                              | application/json                                 |
| errors.GetV1AddressEnrichResponseResponseBody    | 401                                              | application/json                                 |
| errors.GetV1AddressEnrichResponse403ResponseBody | 403                                              | application/json                                 |
| errors.GetV1AddressEnrichResponse404ResponseBody | 404                                              | application/json                                 |
| errors.GetV1AddressEnrichResponse429ResponseBody | 429                                              | application/json                                 |
| errors.GetV1AddressEnrichResponse500ResponseBody | 500                                              | application/json                                 |
| errors.ProntiqDefaultError                       | 4XX, 5XX                                         | \*/\*                                            |

## getV1AddressReverse

Reverse geocode nearby addresses

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/v1/address/reverse" method="get" path="/v1/address/reverse" -->
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressReverse(6837.5, 8129.15);

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { ProntiqCore } from "@prontiq/sdk/core.js";
import { getV1AddressReverse } from "@prontiq/sdk/funcs/get-v1-address-reverse.js";

// Use `ProntiqCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const prontiq = new ProntiqCore({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const res = await getV1AddressReverse(prontiq, 6837.5, 8129.15);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("getV1AddressReverse failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lat`                                                                                                                                                                          | *number*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | Latitude in decimal degrees.                                                                                                                                                   |
| `lon`                                                                                                                                                                          | *number*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | Longitude in decimal degrees.                                                                                                                                                  |
| `radius`                                                                                                                                                                       | *number*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Search radius in metres.                                                                                                                                                       |
| `limit`                                                                                                                                                                        | *number*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Maximum number of nearby addresses to return.                                                                                                                                  |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetV1AddressReverseResponseBody](../../models/operations/get-v1-address-reverse-response-body.md)\>**

### Errors

| Error Type                                        | Status Code                                       | Content Type                                      |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| errors.GetV1AddressReverseResponseBody            | 400                                               | application/json                                  |
| errors.GetV1AddressReverseResponseResponseBody    | 401                                               | application/json                                  |
| errors.GetV1AddressReverseResponse403ResponseBody | 403                                               | application/json                                  |
| errors.GetV1AddressReverseResponse429ResponseBody | 429                                               | application/json                                  |
| errors.GetV1AddressReverseResponse500ResponseBody | 500                                               | application/json                                  |
| errors.ProntiqDefaultError                        | 4XX, 5XX                                          | \*/\*                                             |

## getV1AddressLookupPostcode

Look up localities by postcode

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/v1/address/lookup/postcode" method="get" path="/v1/address/lookup/postcode" -->
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressLookupPostcode("69189");

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { ProntiqCore } from "@prontiq/sdk/core.js";
import { getV1AddressLookupPostcode } from "@prontiq/sdk/funcs/get-v1-address-lookup-postcode.js";

// Use `ProntiqCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const prontiq = new ProntiqCore({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const res = await getV1AddressLookupPostcode(prontiq, "69189");
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("getV1AddressLookupPostcode failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postcode`                                                                                                                                                                     | *string*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | Australian 4-digit postcode.                                                                                                                                                   |
| `limit`                                                                                                                                                                        | *number*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Maximum number of localities to return.                                                                                                                                        |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetV1AddressLookupPostcodeResponseBody](../../models/operations/get-v1-address-lookup-postcode-response-body.md)\>**

### Errors

| Error Type                                               | Status Code                                              | Content Type                                             |
| -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| errors.GetV1AddressLookupPostcodeResponseBody            | 400                                                      | application/json                                         |
| errors.GetV1AddressLookupPostcodeResponseResponseBody    | 401                                                      | application/json                                         |
| errors.GetV1AddressLookupPostcodeResponse403ResponseBody | 403                                                      | application/json                                         |
| errors.GetV1AddressLookupPostcodeResponse429ResponseBody | 429                                                      | application/json                                         |
| errors.GetV1AddressLookupPostcodeResponse500ResponseBody | 500                                                      | application/json                                         |
| errors.ProntiqDefaultError                               | 4XX, 5XX                                                 | \*/\*                                                    |

## getV1AddressLookupSuburb

Look up postcodes by suburb

### Example Usage

<!-- UsageSnippet language="typescript" operationID="get_/v1/address/lookup/suburb" method="get" path="/v1/address/lookup/suburb" -->
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressLookupSuburb("<value>");

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { ProntiqCore } from "@prontiq/sdk/core.js";
import { getV1AddressLookupSuburb } from "@prontiq/sdk/funcs/get-v1-address-lookup-suburb.js";

// Use `ProntiqCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const prontiq = new ProntiqCore({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const res = await getV1AddressLookupSuburb(prontiq, "<value>");
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("getV1AddressLookupSuburb failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter                                                                                                                                                                      | Type                                                                                                                                                                           | Required                                                                                                                                                                       | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `suburb`                                                                                                                                                                       | *string*                                                                                                                                                                       | :heavy_check_mark:                                                                                                                                                             | Suburb/locality name.                                                                                                                                                          |
| `state`                                                                                                                                                                        | *string*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Australian state code.                                                                                                                                                         |
| `limit`                                                                                                                                                                        | *number*                                                                                                                                                                       | :heavy_minus_sign:                                                                                                                                                             | Maximum number of postcodes to return.                                                                                                                                         |
| `options`                                                                                                                                                                      | RequestOptions                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                             | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions`                                                                                                                                                         | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                                                                        | :heavy_minus_sign:                                                                                                                                                             | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`                                                                                                                                                              | [RetryConfig](../../lib/utils/retryconfig.md)                                                                                                                                  | :heavy_minus_sign:                                                                                                                                                             | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.GetV1AddressLookupSuburbResponseBody](../../models/operations/get-v1-address-lookup-suburb-response-body.md)\>**

### Errors

| Error Type                                             | Status Code                                            | Content Type                                           |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| errors.GetV1AddressLookupSuburbResponseBody            | 400                                                    | application/json                                       |
| errors.GetV1AddressLookupSuburbResponseResponseBody    | 401                                                    | application/json                                       |
| errors.GetV1AddressLookupSuburbResponse403ResponseBody | 403                                                    | application/json                                       |
| errors.GetV1AddressLookupSuburbResponse429ResponseBody | 429                                                    | application/json                                       |
| errors.GetV1AddressLookupSuburbResponse500ResponseBody | 500                                                    | application/json                                       |
| errors.ProntiqDefaultError                             | 4XX, 5XX                                               | \*/\*                                                  |