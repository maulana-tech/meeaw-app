# Continue cross-border Send draft

The user asked to continue another agent's uncommitted work and selected real
reference FX rates with caching. Retain the existing native-token payment flow.

- Replace undated demo FX constants with a generic USD snapshot from Frankfurter
  v2, fetched server-side for a fixed currency list. No amount, wallet, recipient
  or chosen currency is sent upstream. Client conversion is display-only.
- Cache one hour, deduplicate concurrent reads, back off failed refreshes and
  allow labelled cached fallback only while reference dates remain recent.
  Reject malformed/future/older-than-seven-day data. FX failure never blocks Send.
- Preserve automatic locale selection and allow a local currency preference,
  shared between form/review/progress. Store only that public preference locally.
  Show rate date/source, nominal USD assumption and test-funds status.
- Measure monotonic elapsed time from the final payment submission until the
  matching operation is observed confirmed. Ignore merge/split preparation,
  failed operations, other records/accounts and old results after unmount.
  Keep unknown outcomes pending. No fabricated time after reload or reopening.
- Label the measurement as confirmation observed in this tab, not chain
  finality or a performance guarantee. Do not alter proofs, retries, sponsorship,
  contracts, transaction payloads or transfer amounts.

Evidence: pure validation/cache/timer tests, UI failure/review tests and hook
account-switch/polling tests, source types, scoped Biome, production build and
HTTP checks. Browser/device and funded payment evidence remain separate.

Source: [Frankfurter v2 docs](https://frankfurter.dev/). API connectivity and
USD/IDR response were checked read-only before implementation.
