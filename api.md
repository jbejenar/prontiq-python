# Address

Types:

```python
from prontiq.types import (
    AddressAutocompleteResponse,
    AddressEnrichResponse,
    AddressReverseGeocodeResponse,
    AddressValidateResponse,
)
```

Methods:

- <code title="get /v1/address/autocomplete">client.address.<a href="./src/prontiq/resources/address/address.py">autocomplete</a>(\*\*<a href="src/prontiq/types/address_autocomplete_params.py">params</a>) -> <a href="./src/prontiq/types/address_autocomplete_response.py">AddressAutocompleteResponse</a></code>
- <code title="get /v1/address/enrich">client.address.<a href="./src/prontiq/resources/address/address.py">enrich</a>(\*\*<a href="src/prontiq/types/address_enrich_params.py">params</a>) -> <a href="./src/prontiq/types/address_enrich_response.py">AddressEnrichResponse</a></code>
- <code title="get /v1/address/reverse">client.address.<a href="./src/prontiq/resources/address/address.py">reverse_geocode</a>(\*\*<a href="src/prontiq/types/address_reverse_geocode_params.py">params</a>) -> <a href="./src/prontiq/types/address_reverse_geocode_response.py">AddressReverseGeocodeResponse</a></code>
- <code title="get /v1/address/validate">client.address.<a href="./src/prontiq/resources/address/address.py">validate</a>(\*\*<a href="src/prontiq/types/address_validate_params.py">params</a>) -> <a href="./src/prontiq/types/address_validate_response.py">AddressValidateResponse</a></code>

## Lookup

Types:

```python
from prontiq.types.address import LookupByPostcodeResponse, LookupBySuburbResponse
```

Methods:

- <code title="get /v1/address/lookup/postcode">client.address.lookup.<a href="./src/prontiq/resources/address/lookup.py">by_postcode</a>(\*\*<a href="src/prontiq/types/address/lookup_by_postcode_params.py">params</a>) -> <a href="./src/prontiq/types/address/lookup_by_postcode_response.py">LookupByPostcodeResponse</a></code>
- <code title="get /v1/address/lookup/suburb">client.address.lookup.<a href="./src/prontiq/resources/address/lookup.py">by_suburb</a>(\*\*<a href="src/prontiq/types/address/lookup_by_suburb_params.py">params</a>) -> <a href="./src/prontiq/types/address/lookup_by_suburb_response.py">LookupBySuburbResponse</a></code>
