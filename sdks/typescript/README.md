# @prontiq/sdk

Developer-friendly & type-safe Typescript SDK specifically catered to leverage *@prontiq/sdk* API.

[![Built by Speakeasy](https://img.shields.io/badge/Built_by-SPEAKEASY-374151?style=for-the-badge&labelColor=f3f4f6)](https://www.speakeasy.com/?utm_source=@prontiq/sdk&utm_campaign=typescript)
[![License: MIT](https://img.shields.io/badge/LICENSE_//_MIT-3b5bdb?style=for-the-badge&labelColor=eff6ff)](https://opensource.org/licenses/MIT)


<br /><br />
> [!IMPORTANT]
> This SDK is not yet ready for production use. To complete setup please follow the steps outlined in your [workspace](https://app.speakeasy.com/org/prontiq/prontiq-workspace). Delete this section before > publishing to a package manager.

<!-- Start Summary [summary] -->
## Summary

Prontiq API: Unified API for Australian and global open data products.
<!-- End Summary [summary] -->

<!-- Start Table of Contents [toc] -->
## Table of Contents
<!-- $toc-max-depth=2 -->
* [@prontiq/sdk](#prontiqsdk)
  * [SDK Installation](#sdk-installation)
  * [Requirements](#requirements)
  * [SDK Example Usage](#sdk-example-usage)
  * [Authentication](#authentication)
  * [Available Resources and Operations](#available-resources-and-operations)
  * [Standalone functions](#standalone-functions)
  * [Retries](#retries)
  * [Error Handling](#error-handling)
  * [Custom HTTP Client](#custom-http-client)
  * [Debugging](#debugging)
* [Development](#development)
  * [Maturity](#maturity)
  * [Contributions](#contributions)

<!-- End Table of Contents [toc] -->

<!-- Start SDK Installation [installation] -->
## SDK Installation

The SDK can be installed with either [npm](https://www.npmjs.com/), [pnpm](https://pnpm.io/), [bun](https://bun.sh/) or [yarn](https://classic.yarnpkg.com/en/) package managers.

### NPM

```bash
npm add @prontiq/sdk
```

### PNPM

```bash
pnpm add @prontiq/sdk
```

### Bun

```bash
bun add @prontiq/sdk
```

### Yarn

```bash
yarn add @prontiq/sdk
```

> [!NOTE]
> This package is published as an ES Module (ESM) only. For applications using
> CommonJS, use `await import("@prontiq/sdk")` to import and use this package.
<!-- End SDK Installation [installation] -->

<!-- Start Requirements [requirements] -->
## Requirements

For supported JavaScript runtimes, please consult [RUNTIMES.md](RUNTIMES.md).
<!-- End Requirements [requirements] -->

<!-- Start SDK Example Usage [usage] -->
## SDK Example Usage

### Example

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

<!-- Start Authentication [security] -->
## Authentication

### Per-Client Security Schemes

This SDK supports the following security scheme globally:

| Name         | Type   | Scheme  |
| ------------ | ------ | ------- |
| `apiKeyAuth` | apiKey | API key |

To authenticate with the API the `apiKeyAuth` parameter must be set when initializing the SDK client instance. For example:
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
<!-- End Authentication [security] -->

<!-- Start Available Resources and Operations [operations] -->
## Available Resources and Operations

<details open>
<summary>Available methods</summary>

### [Prontiq SDK](docs/sdks/prontiq/README.md)

* [getV1AddressAutocomplete](docs/sdks/prontiq/README.md#getv1addressautocomplete) - Autocomplete addresses
* [getV1AddressValidate](docs/sdks/prontiq/README.md#getv1addressvalidate) - Validate an address
* [getV1AddressEnrich](docs/sdks/prontiq/README.md#getv1addressenrich) - Enrich an address by ID
* [getV1AddressReverse](docs/sdks/prontiq/README.md#getv1addressreverse) - Reverse geocode nearby addresses
* [getV1AddressLookupPostcode](docs/sdks/prontiq/README.md#getv1addresslookuppostcode) - Look up localities by postcode
* [getV1AddressLookupSuburb](docs/sdks/prontiq/README.md#getv1addresslookupsuburb) - Look up postcodes by suburb

</details>
<!-- End Available Resources and Operations [operations] -->

<!-- Start Standalone functions [standalone-funcs] -->
## Standalone functions

All the methods listed above are available as standalone functions. These
functions are ideal for use in applications running in the browser, serverless
runtimes or other environments where application bundle size is a primary
concern. When using a bundler to build your application, all unused
functionality will be either excluded from the final bundle or tree-shaken away.

To read more about standalone functions, check [FUNCTIONS.md](./FUNCTIONS.md).

<details>

<summary>Available standalone functions</summary>

- [`getV1AddressAutocomplete`](docs/sdks/prontiq/README.md#getv1addressautocomplete) - Autocomplete addresses
- [`getV1AddressEnrich`](docs/sdks/prontiq/README.md#getv1addressenrich) - Enrich an address by ID
- [`getV1AddressLookupPostcode`](docs/sdks/prontiq/README.md#getv1addresslookuppostcode) - Look up localities by postcode
- [`getV1AddressLookupSuburb`](docs/sdks/prontiq/README.md#getv1addresslookupsuburb) - Look up postcodes by suburb
- [`getV1AddressReverse`](docs/sdks/prontiq/README.md#getv1addressreverse) - Reverse geocode nearby addresses
- [`getV1AddressValidate`](docs/sdks/prontiq/README.md#getv1addressvalidate) - Validate an address

</details>
<!-- End Standalone functions [standalone-funcs] -->

<!-- Start Retries [retries] -->
## Retries

Some of the endpoints in this SDK support retries.  If you use the SDK without any configuration, it will fall back to the default retry strategy provided by the API.  However, the default retry strategy can be overridden on a per-operation basis, or across the entire SDK.

To change the default retry strategy for a single API call, simply provide a retryConfig object to the call:
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressAutocomplete(
    "<value>",
    undefined,
    undefined,
    {
      retries: {
        strategy: "backoff",
        backoff: {
          initialInterval: 1,
          maxInterval: 50,
          exponent: 1.1,
          maxElapsedTime: 100,
        },
        retryConnectionErrors: false,
      },
    },
  );

  console.log(result);
}

run();

```

If you'd like to override the default retry strategy for all operations that support retries, you can provide a retryConfig at SDK initialization:
```typescript
import { Prontiq } from "@prontiq/sdk";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  retryConfig: {
    strategy: "backoff",
    backoff: {
      initialInterval: 1,
      maxInterval: 50,
      exponent: 1.1,
      maxElapsedTime: 100,
    },
    retryConnectionErrors: false,
  },
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  const result = await prontiq.getV1AddressAutocomplete("<value>");

  console.log(result);
}

run();

```
<!-- End Retries [retries] -->

<!-- Start Error Handling [errors] -->
## Error Handling

[`ProntiqError`](./src/models/errors/prontiq-error.ts) is the base class for all HTTP error responses. It has the following properties:

| Property            | Type       | Description                                                                             |
| ------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `error.message`     | `string`   | Error message                                                                           |
| `error.statusCode`  | `number`   | HTTP response status code eg `404`                                                      |
| `error.headers`     | `Headers`  | HTTP response headers                                                                   |
| `error.body`        | `string`   | HTTP body. Can be empty string if no body is returned.                                  |
| `error.rawResponse` | `Response` | Raw HTTP response                                                                       |
| `error.data$`       |            | Optional. Some errors may contain structured data. [See Error Classes](#error-classes). |

### Example
```typescript
import { Prontiq } from "@prontiq/sdk";
import * as errors from "@prontiq/sdk/models/errors";

const prontiq = new Prontiq({
  serverURL: "https://api.example.com",
  apiKeyAuth: "<YOUR_API_KEY_HERE>",
});

async function run() {
  try {
    const result = await prontiq.getV1AddressAutocomplete("<value>");

    console.log(result);
  } catch (error) {
    // The base class for HTTP error responses
    if (error instanceof errors.ProntiqError) {
      console.log(error.message);
      console.log(error.statusCode);
      console.log(error.body);
      console.log(error.headers);

      // Depending on the method different errors may be thrown
      if (error instanceof errors.GetV1AddressAutocompleteResponseBody) {
        console.log(error.data$.error); // errors.ErrorT
      }
    }
  }
}

run();

```

### Error Classes
**Primary error:**
* [`ProntiqError`](./src/models/errors/prontiq-error.ts): The base class for HTTP error responses.

<details><summary>Less common errors (37)</summary>

<br />

**Network errors:**
* [`ConnectionError`](./src/models/errors/http-client-errors.ts): HTTP client was unable to make a request to a server.
* [`RequestTimeoutError`](./src/models/errors/http-client-errors.ts): HTTP request timed out due to an AbortSignal signal.
* [`RequestAbortedError`](./src/models/errors/http-client-errors.ts): HTTP request was aborted by the client.
* [`InvalidRequestError`](./src/models/errors/http-client-errors.ts): Any input used to create a request is invalid.
* [`UnexpectedClientError`](./src/models/errors/http-client-errors.ts): Unrecognised or unexpected error.


**Inherit from [`ProntiqError`](./src/models/errors/prontiq-error.ts)**:
* [`GetV1AddressAutocompleteResponseBody`](./src/models/errors/get-v1-address-autocomplete-response-body.ts): Invalid query parameters. Status code `400`. Applicable to 1 of 6 methods.*
* [`GetV1AddressValidateResponseBody`](./src/models/errors/get-v1-address-validate-response-body.ts): Invalid query parameters. Status code `400`. Applicable to 1 of 6 methods.*
* [`GetV1AddressEnrichResponseBody`](./src/models/errors/get-v1-address-enrich-response-body.ts): Invalid query parameters. Status code `400`. Applicable to 1 of 6 methods.*
* [`GetV1AddressReverseResponseBody`](./src/models/errors/get-v1-address-reverse-response-body.ts): Invalid query parameters. Status code `400`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupPostcodeResponseBody`](./src/models/errors/get-v1-address-lookup-postcode-response-body.ts): Invalid query parameters. Status code `400`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupSuburbResponseBody`](./src/models/errors/get-v1-address-lookup-suburb-response-body.ts): Invalid query parameters. Status code `400`. Applicable to 1 of 6 methods.*
* [`GetV1AddressAutocompleteResponseResponseBody`](./src/models/errors/get-v1-address-autocomplete-response-response-body.ts): Missing or invalid API key. Status code `401`. Applicable to 1 of 6 methods.*
* [`GetV1AddressValidateResponseResponseBody`](./src/models/errors/get-v1-address-validate-response-response-body.ts): Missing or invalid API key. Status code `401`. Applicable to 1 of 6 methods.*
* [`GetV1AddressEnrichResponseResponseBody`](./src/models/errors/get-v1-address-enrich-response-response-body.ts): Missing or invalid API key. Status code `401`. Applicable to 1 of 6 methods.*
* [`GetV1AddressReverseResponseResponseBody`](./src/models/errors/get-v1-address-reverse-response-response-body.ts): Missing or invalid API key. Status code `401`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupPostcodeResponseResponseBody`](./src/models/errors/get-v1-address-lookup-postcode-response-response-body.ts): Missing or invalid API key. Status code `401`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupSuburbResponseResponseBody`](./src/models/errors/get-v1-address-lookup-suburb-response-response-body.ts): Missing or invalid API key. Status code `401`. Applicable to 1 of 6 methods.*
* [`GetV1AddressAutocompleteResponse403ResponseBody`](./src/models/errors/get-v1-address-autocomplete-response403-response-body.ts): Product not included in plan. Status code `403`. Applicable to 1 of 6 methods.*
* [`GetV1AddressValidateResponse403ResponseBody`](./src/models/errors/get-v1-address-validate-response403-response-body.ts): Product not included in plan. Status code `403`. Applicable to 1 of 6 methods.*
* [`GetV1AddressEnrichResponse403ResponseBody`](./src/models/errors/get-v1-address-enrich-response403-response-body.ts): Product not included in plan. Status code `403`. Applicable to 1 of 6 methods.*
* [`GetV1AddressReverseResponse403ResponseBody`](./src/models/errors/get-v1-address-reverse-response403-response-body.ts): Product not included in plan. Status code `403`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupPostcodeResponse403ResponseBody`](./src/models/errors/get-v1-address-lookup-postcode-response403-response-body.ts): Product not included in plan. Status code `403`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupSuburbResponse403ResponseBody`](./src/models/errors/get-v1-address-lookup-suburb-response403-response-body.ts): Product not included in plan. Status code `403`. Applicable to 1 of 6 methods.*
* [`GetV1AddressEnrichResponse404ResponseBody`](./src/models/errors/get-v1-address-enrich-response404-response-body.ts): Address not found. Status code `404`. Applicable to 1 of 6 methods.*
* [`GetV1AddressAutocompleteResponse429ResponseBody`](./src/models/errors/get-v1-address-autocomplete-response429-response-body.ts): Rate limit or quota exceeded. Status code `429`. Applicable to 1 of 6 methods.*
* [`GetV1AddressValidateResponse429ResponseBody`](./src/models/errors/get-v1-address-validate-response429-response-body.ts): Rate limit or quota exceeded. Status code `429`. Applicable to 1 of 6 methods.*
* [`GetV1AddressEnrichResponse429ResponseBody`](./src/models/errors/get-v1-address-enrich-response429-response-body.ts): Rate limit or quota exceeded. Status code `429`. Applicable to 1 of 6 methods.*
* [`GetV1AddressReverseResponse429ResponseBody`](./src/models/errors/get-v1-address-reverse-response429-response-body.ts): Rate limit or quota exceeded. Status code `429`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupPostcodeResponse429ResponseBody`](./src/models/errors/get-v1-address-lookup-postcode-response429-response-body.ts): Rate limit or quota exceeded. Status code `429`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupSuburbResponse429ResponseBody`](./src/models/errors/get-v1-address-lookup-suburb-response429-response-body.ts): Rate limit or quota exceeded. Status code `429`. Applicable to 1 of 6 methods.*
* [`GetV1AddressAutocompleteResponse500ResponseBody`](./src/models/errors/get-v1-address-autocomplete-response500-response-body.ts): Internal server error. Status code `500`. Applicable to 1 of 6 methods.*
* [`GetV1AddressValidateResponse500ResponseBody`](./src/models/errors/get-v1-address-validate-response500-response-body.ts): Internal server error. Status code `500`. Applicable to 1 of 6 methods.*
* [`GetV1AddressEnrichResponse500ResponseBody`](./src/models/errors/get-v1-address-enrich-response500-response-body.ts): Internal server error. Status code `500`. Applicable to 1 of 6 methods.*
* [`GetV1AddressReverseResponse500ResponseBody`](./src/models/errors/get-v1-address-reverse-response500-response-body.ts): Internal server error. Status code `500`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupPostcodeResponse500ResponseBody`](./src/models/errors/get-v1-address-lookup-postcode-response500-response-body.ts): Internal server error. Status code `500`. Applicable to 1 of 6 methods.*
* [`GetV1AddressLookupSuburbResponse500ResponseBody`](./src/models/errors/get-v1-address-lookup-suburb-response500-response-body.ts): Internal server error. Status code `500`. Applicable to 1 of 6 methods.*
* [`ResponseValidationError`](./src/models/errors/response-validation-error.ts): Type mismatch between the data returned from the server and the structure expected by the SDK. See `error.rawValue` for the raw value and `error.pretty()` for a nicely formatted multi-line string.

</details>

\* Check [the method documentation](#available-resources-and-operations) to see if the error is applicable.
<!-- End Error Handling [errors] -->

<!-- Start Custom HTTP Client [http-client] -->
## Custom HTTP Client

The TypeScript SDK makes API calls using an `HTTPClient` that wraps the native
[Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). This
client is a thin wrapper around `fetch` and provides the ability to attach hooks
around the request lifecycle that can be used to modify the request or handle
errors and response.

The `HTTPClient` constructor takes an optional `fetcher` argument that can be
used to integrate a third-party HTTP client or when writing tests to mock out
the HTTP client and feed in fixtures.

The following example shows how to:
- route requests through a proxy server using [undici](https://www.npmjs.com/package/undici)'s ProxyAgent
- use the `"beforeRequest"` hook to add a custom header and a timeout to requests
- use the `"requestError"` hook to log errors

```typescript
import { Prontiq } from "@prontiq/sdk";
import { ProxyAgent } from "undici";
import { HTTPClient } from "@prontiq/sdk/lib/http";

const dispatcher = new ProxyAgent("http://proxy.example.com:8080");

const httpClient = new HTTPClient({
  // 'fetcher' takes a function that has the same signature as native 'fetch'.
  fetcher: (input, init) =>
    // 'dispatcher' is specific to undici and not part of the standard Fetch API.
    fetch(input, { ...init, dispatcher } as RequestInit),
});

httpClient.addHook("beforeRequest", (request) => {
  const nextRequest = new Request(request, {
    signal: request.signal || AbortSignal.timeout(5000)
  });

  nextRequest.headers.set("x-custom-header", "custom value");

  return nextRequest;
});

httpClient.addHook("requestError", (error, request) => {
  console.group("Request Error");
  console.log("Reason:", `${error}`);
  console.log("Endpoint:", `${request.method} ${request.url}`);
  console.groupEnd();
});

const sdk = new Prontiq({ httpClient: httpClient });
```
<!-- End Custom HTTP Client [http-client] -->

<!-- Start Debugging [debug] -->
## Debugging

You can setup your SDK to emit debug logs for SDK requests and responses.

You can pass a logger that matches `console`'s interface as an SDK option.

> [!WARNING]
> Beware that debug logging will reveal secrets, like API tokens in headers, in log messages printed to a console or files. It's recommended to use this feature only during local development and not in production.

```typescript
import { Prontiq } from "@prontiq/sdk";

const sdk = new Prontiq({ debugLogger: console });
```
<!-- End Debugging [debug] -->

<!-- Placeholder for Future Speakeasy SDK Sections -->

# Development

## Maturity

This SDK is in beta, and there may be breaking changes between versions without a major version update. Therefore, we recommend pinning usage
to a specific package version. This way, you can install the same version each time without breaking changes unless you are intentionally
looking for the latest version.

## Contributions

While we value open-source contributions to this SDK, this library is generated programmatically. Any manual changes added to internal files will be overwritten on the next generation. 
We look forward to hearing your feedback. Feel free to open a PR or an issue with a proof of concept and we'll do our best to include it in a future release. 

### SDK Created by [Speakeasy](https://www.speakeasy.com/?utm_source=@prontiq/sdk&utm_campaign=typescript)
