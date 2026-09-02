# Holmes Retirement Engine

Holmes has two explicit modes:

- **Custom Scenario** is a deterministic, single-path projection using the
  configured account growth and cash-flow rates.
- **Historical Monte Carlo** uses a seeded contiguous walk through
  `backend/data/spx_yearly_price_returns_1940.csv`. The source is ordered
  complete-calendar-year S&P 500 *price* return data through 2025, not total
  returns. Incomplete current-year observations are rejected. When a plan crosses
  the end of the file, the default `historical_wrap_mode=continue` wraps to
  the first observation and reports the indices and wrap count. Set
  `historical_wrap_mode=error` to block instead of continuing.

The timeline is age-first and inclusive: it starts at `current_age` and ends
at `plan_through_age` (85–115, default 100). Missing API seeds use deterministic
seed `0`; the returned metadata and request token make a run inspectable and
replayable.

The shared accounting core applies the documented simplified 2025 federal tax
table (MFJ or Single), standard Social Security provisional-income treatment,
iterative pre-tax gross-up that rechecks Social Security taxability, 1% eligible
dividend yield, 10% sale haircut,
prior-Dec-31 RMD balances at age 73 (or 75), and the visible withdrawal order.
Property sales are all-or-nothing. Every home or rental has its own ownership
share, annual revenue, operating expenses, mortgage balance, rate, payment and
remaining-payment schedule. Property values and operating figures follow the
global inflation path; positive net operating income is modeled as rental
income, and a property's cash flow ends when that property is sold. Unallocated
proceeds are retained in an explicit cash reserve rather than dropped.

Each result row keeps total, liquid and property net worth separate. The
Monte Carlo summary includes the median liquid/property snapshot alongside its
total-wealth percentiles.

Historical runs are capped at 5,000 per request. The aggregator retains the
percentile inputs and compact outcomes instead of every full run ledger, keeping
large-but-reasonable requests from exhausting local memory.

Assets and income streams have explicit type selectors (including Bitcoin,
salary, rental income, royalties, and Social Security), so renaming a label
does not change how the account or stream is modeled.

Adaptive spending is opt-in and only reduces expenses marked **Flexible**;
housing and health-insurance defaults stay protected. Every visible account and
event carries a stable internal ID so renaming it does not change its identity.
If a plan has workplace income but no pre-tax account, contributions and the
match are routed to a named taxable/Roth account (or the explicit cash reserve)
and the destination is returned with each row.

Runs are immutable snapshots: changing inputs never silently re-runs a result.
The UI marks an old result stale, requires an explicit Run, and can save/load
multiple named scenarios in the browser or export the visible year-by-year
ledger as CSV. Saved scenarios stay on that browser and device; no account or
cloud sync is required.

## Run locally

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
./run_app.sh
```

The API is served on `127.0.0.1:8000` and the Vite UI on `127.0.0.1:5173`.
`backend/.venv` and `backend/venv` are intentionally ignored; generated
environments and caches do not belong in the repository.
