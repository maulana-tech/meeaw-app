# Local currency estimates in Send

Send USDC and Send AUSD show an optional fiat reference beside the token amount.
Choose a currency in the Send form; the same choice is used in review and transfer
progress. The browser stores only the currency code. The amount sent remains the
exact native token amount reviewed and signed by the sender.

The public `/api/fx` endpoint retrieves a fixed USD reference list from
[Frankfurter v2](https://frankfurter.dev/). Neither amounts, recipients, wallet
addresses nor a user's selected currency are sent to the provider. The browser
calculates the display estimate. Rates are daily references, not conversion or
cash-out offers. Displays include their source and reference date and explicitly
assume one stablecoin unit equals one nominal USD. Testnet funds have no cash value.

The snapshot's original fetch time anchors a one-hour cache across the server,
HTTP caches and browser. Concurrent reads are deduplicated. A failed refresh backs
off for 30 seconds and may use a labelled cached reference. Malformed, future or
older-than-seven-day reference dates are rejected; unavailable FX never disables
payment review or submission. Cache is in memory per process, with no new database
or credentials required. The host needs HTTPS access to `api.frankfurter.dev`.

For payments submitted in the current tab, progress can show “Confirmation
observed after … in this tab.” This uses a monotonic clock from the final payment
API submission until the matching operation is observed confirmed with a
transaction hash. Merge/split preparation is excluded. A lost submit response can
still finish through polling. Reopening or reloading does not manufacture a
duration. This measures the app's observation, including network and polling
delays; it does not measure consensus finality or promise a settlement speed.

Verification uses mocked provider failures, cache/date/amount boundaries,
component interactions, account/unmount guards and the existing transfer runner.
Local tests and builds do not establish a funded AUSD payment, mobile installation
or eligibility for an Agora bounty. Those still need a live device/demo check.
