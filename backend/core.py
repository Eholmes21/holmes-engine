"""Shared accounting engine for deterministic and Monte Carlo projections.

The original application had three subtly different ledgers: ``/simulate``,
``/monte_carlo`` and ``/monte_carlo_run`` each implemented their own copy of
the withdrawal, tax and property logic.  This module owns the accounting
rules.  The HTTP layer only validates requests, chooses a return source and
serializes the result.

Amounts in this application are user-facing dollars (the historical Holmes
API predates the cents-based canonical API in the parent repository).  All
operations nevertheless reject non-finite values and negative balances; no
input is silently clamped or replaced with a fallback.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import csv
from datetime import date
import hashlib
import math
from pathlib import Path
import random
from typing import Any, Iterable, Mapping, Sequence


# The public constants are retained for callers that imported them from the
# old single-file implementation.  A sale haircut is a disclosed deduction
# from a taxable/property sale, not an implicit tax-rate guess.
DEFAULT_SALE_HAIRCUT = 0.10
TAXABLE_SALE_TAX_RATE = DEFAULT_SALE_HAIRCUT
TAXABLE_SALE_NET_FACTOR = 1.0 - DEFAULT_SALE_HAIRCUT
DEFAULT_DIVIDEND_YIELD = 0.01
PRE_TAX_WITHDRAWAL_TAX_RATE = 0.25
MAX_MONTE_CARLO_RUNS = 5000
# A missing seed is still a reproducible plan.  The UI always exposes a seed,
# but API callers should not get a different answer merely because they omit
# it.  ``0`` is also easy to recognize in saved plans and audit records.
DEFAULT_SEED = 0


class AccountingBlocked(ValueError):
    """A calculation cannot safely continue and must be shown to the user."""

    def __init__(self, code: str, message: str, *, path: str = "request") -> None:
        self.code = code
        self.message = message
        self.path = path
        super().__init__(message)


class HistoricalDataError(AccountingBlocked):
    """The requested historical return source is unavailable or malformed."""


def _finite(value: float, *, field_name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{field_name} must be a finite number") from None
    if not math.isfinite(number):
        raise ValueError(f"{field_name} must be finite")
    return number


def _positive_or_zero(value: float, *, field_name: str) -> float:
    number = _finite(value, field_name=field_name)
    if number < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return number


def _asset_kind(asset: Any) -> str:
    """Normalize the small set of account labels used by old clients."""

    treatment = str(getattr(asset, "tax_treatment", "taxable") or "taxable").strip().lower()
    if treatment in {"bitcoin", "crypto"}:
        return "bitcoin"
    if treatment in {"pre_tax", "pretax", "traditional", "traditional_ira", "tax_deferred", "401k"}:
        return "pre_tax"
    if treatment in {"roth", "roth_ira", "tax_free", "tax_advantaged_roth"}:
        return "roth"
    if treatment in {"real_estate", "property", "rental", "home"}:
        return "real_estate"
    if treatment in {"tax_advantaged", "tax_deferred_or_roth"}:
        # This generic label is intentionally treated as pre-tax so its
        # dividend is reinvested rather than taxed as brokerage income.
        return "pre_tax"
    return "taxable"


def _is_bitcoin(name: str) -> bool:
    return "bitcoin" in name.lower() or "crypto" in name.lower()


def _is_primary(name: str, asset: Any | None = None) -> bool:
    role = str(getattr(asset, "property_role", "") or "").strip().lower()
    if role in {"rental", "primary", "primary_home", "home"}:
        # An explicit property role wins over a display label. Renaming a
        # rental to "Primary Home" must not move it into the home bucket.
        return role in {"primary", "primary_home", "home"}
    return "primary" in name.lower()


def _is_workplace_plan(asset: Any) -> bool:
    """Whether a pre-tax account may use the workplace RMD delay."""

    return bool(getattr(asset, "workplace_plan", False))


def _stable_id(prefix: str, item: Any, index: int) -> str:
    supplied = getattr(item, "id", None)
    if supplied:
        return str(supplied)
    name = str(getattr(item, "name", "") or "")
    slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")
    if not slug:
        slug = str(index + 1)
    # The name is normally unique and therefore produces a readable stable
    # identifier.  The index suffix is only a deterministic fallback for an
    # otherwise blank name (blank names are rejected by the request model).
    return f"{prefix}_{slug}"


def _social_security_taxable_amount(benefit: float, other_ordinary_income: float, status: str) -> float:
    """Apply the ordinary-income provisional-income SS rule.

    This is intentionally a small, version-independent planning approximation:
    up to 50% of benefits enters income in the second band and up to 85% in
    the third.  The thresholds are explicit so a future tax-table version can
    change them without silently changing an existing plan.
    """

    benefit = max(0.0, _finite(benefit, field_name="social_security"))
    other = max(0.0, _finite(other_ordinary_income, field_name="ordinary_income"))
    if benefit == 0.0:
        return 0.0
    if status == "single":
        first_threshold, second_threshold = 25_000.0, 34_000.0
    else:
        first_threshold, second_threshold = 32_000.0, 44_000.0
    provisional = other + benefit * 0.5
    if provisional <= first_threshold:
        return 0.0
    first_band = min(benefit * 0.5, max(0.0, (second_threshold - first_threshold) * 0.5))
    if provisional <= second_threshold:
        return min(benefit * 0.5, (provisional - first_threshold) * 0.5)
    return min(benefit * 0.85, first_band + (provisional - second_threshold) * 0.85)


def _percentile(values: Sequence[float], p: float) -> float:
    if not values:
        return 0.0
    if p <= 0:
        return float(values[0])
    if p >= 1:
        return float(values[-1])
    idx = (len(values) - 1) * p
    lo = int(idx)
    hi = min(lo + 1, len(values) - 1)
    weight = idx - lo
    return float(values[lo] * (1.0 - weight) + values[hi] * weight)


# Simplified, versioned 2025 federal tables.  The values are intentionally
# explicit: changing the table is a schema/version decision, not a hidden
# current-law update.  These thresholds reflect the IRS's final 2025 brackets
# and the standard deductions in effect for 2025 returns.
TAX_TABLES: dict[str, dict[str, dict[str, Any]]] = {
    "2025_simplified": {
        "married_joint": {
            "standard_deduction": 31500.0,
            "brackets": (
                (23850.0, 0.10),
                (96950.0, 0.12),
                (206700.0, 0.22),
                (394600.0, 0.24),
                (501050.0, 0.32),
                (751600.0, 0.35),
            ),
            "top_rate": 0.37,
        },
        "single": {
            "standard_deduction": 15750.0,
            "brackets": (
                (11925.0, 0.10),
                (48475.0, 0.12),
                (103350.0, 0.22),
                (197300.0, 0.24),
                (250525.0, 0.32),
                (626350.0, 0.35),
            ),
            "top_rate": 0.37,
        },
    }
}


def normalize_tax_status(status: str | None) -> str:
    value = str(status or "married_joint").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "mfj": "married_joint",
        "married": "married_joint",
        "married_filing_jointly": "married_joint",
        "joint": "married_joint",
        "single_filer": "single",
    }
    value = aliases.get(value, value)
    if value not in {"married_joint", "single"}:
        raise ValueError("tax_filing_status must be married_joint or single")
    return value


def normalize_tax_version(version: str | None) -> str:
    value = str(version or "2025_simplified").strip().lower().replace("-", "_").replace(" ", "_")
    if value in {"2025", "2025_federal", "2025_simple"}:
        value = "2025_simplified"
    if value not in TAX_TABLES:
        raise ValueError("tax_version is unsupported")
    return value


def calculate_federal_tax(
    taxable_income: float,
    years_passed: int = 0,
    inflation: float = 0.0,
    *,
    tax_filing_status: str = "married_joint",
    tax_version: str = "2025_simplified",
    filing_status: str | None = None,
    version: str | None = None,
    inflation_factor: float | None = None,
) -> float:
    """Return simplified federal tax for the requested version and status.

    ``years_passed`` and ``inflation`` are retained for wire compatibility;
    the table is indexed in constant dollars and therefore only indexes the
    bracket thresholds when an inflation assumption is supplied.
    """

    income = max(0.0, _finite(taxable_income, field_name="taxable_income"))
    years = int(years_passed)
    if years < 0:
        raise ValueError("years_passed must be non-negative")
    inflation_rate = _finite(inflation, field_name="inflation")
    if inflation_rate <= -1.0:
        raise ValueError("inflation must be greater than -1")
    status = normalize_tax_status(filing_status if filing_status is not None else tax_filing_status)
    version_name = normalize_tax_version(version if version is not None else tax_version)
    if inflation_factor is None:
        factor = (1.0 + inflation_rate) ** years
    else:
        factor = _finite(inflation_factor, field_name="inflation_factor")
        if factor <= 0.0:
            raise ValueError("inflation_factor must be positive")
    table = TAX_TABLES[version_name][status]
    deduction = table["standard_deduction"] * factor
    taxable = max(0.0, income - deduction)
    tax = 0.0
    previous = 0.0
    for limit_base, rate in table["brackets"]:
        limit = limit_base * factor
        if taxable <= previous:
            break
        amount = min(taxable, limit) - previous
        tax += amount * rate
        previous = limit
    if taxable > previous:
        tax += (taxable - previous) * table["top_rate"]
    return float(tax)


_RMD_DIVISORS = {
    73: 26.5,
    74: 25.5,
    75: 24.6,
    76: 23.7,
    77: 22.9,
    78: 22.0,
    79: 21.1,
    80: 20.2,
    81: 19.4,
    82: 18.5,
    83: 17.7,
    84: 16.8,
    85: 16.0,
    86: 15.2,
    87: 14.4,
    88: 13.7,
    89: 12.9,
    90: 12.2,
    91: 11.5,
    92: 10.8,
    93: 10.1,
    94: 9.5,
    95: 8.9,
    96: 8.4,
    97: 7.8,
    98: 7.3,
    99: 6.8,
    100: 6.4,
    101: 6.0,
    102: 5.6,
    103: 5.2,
    104: 4.9,
    105: 4.6,
    106: 4.3,
    107: 4.1,
    108: 3.9,
    109: 3.7,
    110: 3.5,
    111: 3.4,
    112: 3.3,
    113: 3.1,
    114: 3.0,
    115: 2.9,
}


def get_rmd_divisor(age: int, start_age: int = 73) -> float:
    """Return the Uniform Lifetime divisor for a supported RMD start age."""

    if int(age) < int(start_age):
        return 0.0
    if int(start_age) not in {73, 75}:
        raise ValueError("rmd_start_age must be 73 or 75")
    # The supported planning horizon ends at age 115.  Do not silently use a
    # made-up fallback for an age outside the validated table.
    try:
        return float(_RMD_DIVISORS[int(age)])
    except KeyError:
        raise ValueError("RMD divisor is unavailable for this age") from None


def _load_yearly_returns_csv(path: Path) -> list[float]:
    if not path.exists():
        raise HistoricalDataError("HISTORICAL_DATA_UNAVAILABLE", "Historical return data is unavailable", path="return_source")
    values: list[float] = []
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames or "return" not in reader.fieldnames or "year" not in reader.fieldnames:
                raise HistoricalDataError("HISTORICAL_DATA_INVALID", "Historical return data must contain year and return columns", path="return_source")
            previous_year: int | None = None
            for line_number, row in enumerate(reader, start=2):
                raw_year = row.get("year")
                try:
                    year = int(raw_year) if raw_year is not None else -1
                except (TypeError, ValueError):
                    raise HistoricalDataError(
                        "HISTORICAL_DATA_INVALID",
                        f"Historical return data contains an invalid year at row {line_number}",
                        path="return_source",
                    ) from None
                if previous_year is not None and year != previous_year + 1:
                    raise HistoricalDataError(
                        "HISTORICAL_DATA_INVALID",
                        "Historical return observations must be ordered contiguous annual records",
                        path="return_source",
                    )
                previous_year = year
                if year >= date.today().year:
                    raise HistoricalDataError(
                        "HISTORICAL_DATA_INCOMPLETE",
                        "Historical return data must contain complete calendar years only",
                        path="return_source",
                    )
                raw = row.get("return")
                try:
                    value = float(raw) if raw is not None else float("nan")
                except (TypeError, ValueError):
                    raise HistoricalDataError(
                        "HISTORICAL_DATA_INVALID",
                        f"Historical return data contains an invalid value at row {line_number}",
                        path="return_source",
                    ) from None
                if not math.isfinite(value) or value <= -1.0:
                    raise HistoricalDataError(
                        "HISTORICAL_DATA_INVALID",
                        f"Historical return data contains an unsafe value at row {line_number}",
                        path="return_source",
                    )
                values.append(value)
    except OSError:
        raise HistoricalDataError("HISTORICAL_DATA_UNAVAILABLE", "Historical return data is unavailable", path="return_source") from None
    if not values:
        raise HistoricalDataError("HISTORICAL_DATA_INVALID", "Historical return data is empty", path="return_source")
    return values


def historical_returns_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "spx_yearly_price_returns_1940.csv"


def _historical_source_descriptor(path: Path) -> dict[str, Any]:
    """Return auditable provenance for the validated historical source."""

    try:
        raw = path.read_bytes()
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            years = [int(row["year"]) for row in reader if row.get("year") is not None]
    except (OSError, TypeError, ValueError):
        # The normal loader already provides the user-facing validation error;
        # this guard keeps provenance generation from turning a valid run into
        # an opaque filesystem exception if the file changes between reads.
        return {"source_hash": None, "source_years": []}
    return {
        "source_series": "s_and_p_500_price_returns",
        "source_hash": hashlib.sha256(raw).hexdigest(),
        "source_years": years,
        "source_first_year": years[0] if years else None,
        "source_last_year": years[-1] if years else None,
    }


@dataclass
class ReturnSequence:
    """Contiguous deterministic sequence with explicit wrap metadata."""

    values: tuple[float, ...]
    source: str
    seed: int | None = None
    start_index: int = 0
    wrap_mode: str = "continue"
    cursor: int = 0
    indices: list[int] = field(default_factory=list)
    wraps: int = 0
    source_descriptor: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.values:
            raise HistoricalDataError("HISTORICAL_DATA_INVALID", "Return sequence is empty", path="return_source")
        if self.start_index < 0 or self.start_index >= len(self.values):
            raise ValueError("historical_start_index is outside the return data")
        if self.wrap_mode not in {"continue", "error"}:
            raise ValueError("historical_wrap_mode must be continue or error")

    def next(self) -> float:
        position = self.start_index + self.cursor
        if position >= len(self.values):
            if self.wrap_mode == "error":
                raise HistoricalDataError(
                    "HISTORICAL_SEQUENCE_EXHAUSTED",
                    "Historical return sequence ended before the plan horizon; enable explicit wrap continuation",
                    path="historical_wrap_mode",
                )
            # ``wrap_count`` is the number of completed loops, not the
            # number of rows after the first boundary.  Keep it monotonic as
            # a long horizon crosses multiple data cycles.
            self.wraps = max(self.wraps, position // len(self.values))
        index = position % len(self.values)
        self.indices.append(index)
        self.cursor += 1
        return float(self.values[index])

    @property
    def metadata(self) -> dict[str, Any]:
        metadata = {
            "mode": "historical" if self.source == "historical_csv" else "custom",
            "source": self.source,
            "seed": self.seed,
            "start_index": self.start_index,
            "sequence_length": len(self.values),
            "indices": list(self.indices),
            "wrapped": bool(self.wraps),
            "wrap_count": self.wraps,
            "wrap_continuation": self.wrap_mode,
        }
        if self.source_descriptor:
            metadata.update(self.source_descriptor)
        return metadata


def _seed_for_run(seed: int | None, run_index: int) -> int:
    """Derive stable, independent run seeds without mutable RNG state."""

    seed_value = DEFAULT_SEED if seed is None else int(seed)
    raw = f"{seed_value}:{int(run_index)}".encode("ascii")
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big", signed=False)


def request_fingerprint(
    params: Any,
    *,
    mode: str,
    num_runs: int,
    stock_volatility: float,
    real_estate_volatility: float,
    inflation_volatility: float,
    seed: int | None,
) -> str:
    """Build an immutable token for aggregate/inspector request matching."""

    try:
        payload = params.model_dump(mode="json")
    except AttributeError:
        payload = dict(vars(params))
    # Client request tokens identify a transport attempt, not the economic
    # scenario.  Excluding them keeps aggregate and inspector fingerprints
    # stable when a user retries the exact same plan.
    if isinstance(payload, dict):
        payload.pop("request_token", None)
    envelope = {
        "params": payload,
        "mode": mode,
        "num_runs": int(num_runs),
        "stock_volatility": float(stock_volatility),
        "real_estate_volatility": float(real_estate_volatility),
        "inflation_volatility": float(inflation_volatility),
        "seed": DEFAULT_SEED if seed is None else int(seed),
    }
    encoded = __import__("json").dumps(envelope, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _derive_return_sequence(params: Any, *, mode: str, seed: int | None, intervals: int) -> ReturnSequence | None:
    if mode == "custom":
        custom = getattr(params, "custom_return_sequence", None)
        if custom:
            values = tuple(_finite(v, field_name="custom_return_sequence") for v in custom)
            if any(value <= -1.0 for value in values):
                raise ValueError("custom_return_sequence values must be greater than -1")
            return ReturnSequence(values, source="custom_sequence", seed=seed, start_index=0, wrap_mode=getattr(params, "historical_wrap_mode", "continue"))
        return None
    if mode != "historical":
        raise ValueError("return_mode must be custom or historical")
    path = historical_returns_path()
    values = tuple(_load_yearly_returns_csv(path))
    descriptor = _historical_source_descriptor(path)
    requested_start = getattr(params, "historical_start_index", None)
    if requested_start is None:
        # A missing seed uses the documented deterministic default.  The
        # resulting start index is therefore replayable and inspectable.
        effective_seed = DEFAULT_SEED if seed is None else int(seed)
        start = _seed_for_run(effective_seed, 0) % len(values)
    else:
        start = int(requested_start)
    return ReturnSequence(
        values,
        source="historical_csv",
        seed=DEFAULT_SEED if seed is None else int(seed),
        start_index=start,
        wrap_mode=getattr(params, "historical_wrap_mode", "continue"),
        source_descriptor=descriptor,
    )


def _safe_balance(value: float, *, name: str) -> float:
    number = _finite(value, field_name=name)
    if number < -1e-8:
        raise AccountingBlocked("NEGATIVE_BALANCE", "The accounting core produced a negative balance", path="portfolio")
    return 0.0 if abs(number) < 1e-10 else number


def _add(portfolio: dict[str, float], name: str, amount: float) -> None:
    portfolio[name] = _safe_balance(portfolio[name] + amount, name=name)


def _remove(portfolio: dict[str, float], name: str, amount: float) -> None:
    if amount < -1e-10:
        raise AccountingBlocked("NEGATIVE_DRAW", "A withdrawal amount was negative", path="withdrawal_order")
    if amount > portfolio[name] + 1e-8:
        raise AccountingBlocked("OVERDRAW", "An account was overdrawn", path="portfolio")
    portfolio[name] = _safe_balance(portfolio[name] - amount, name=name)


def _sum_values(portfolio: Mapping[str, float], names: Iterable[str]) -> float:
    total = 0.0
    for name in names:
        total += portfolio[name]
    return _finite(total, field_name="portfolio_total")


def _classify_assets(params: Any) -> tuple[list[Any], dict[str, str], dict[str, str]]:
    assets = list(params.assets)
    portfolio: dict[str, float] = {}
    kinds: dict[str, str] = {}
    ids: dict[str, str] = {}
    for index, asset in enumerate(assets):
        name = str(asset.name)
        value = _positive_or_zero(asset.value, field_name=f"assets.{name}.value")
        normalized_name = " ".join(name.split()).casefold()
        if any(" ".join(existing.split()).casefold() == normalized_name for existing in portfolio):
            raise ValueError("asset names must be unique")
        portfolio[name] = value
        kinds[name] = _asset_kind(asset)
        ids[name] = _stable_id("asset", asset, index)
        if list(ids.values()).count(ids[name]) > 1:
            # Punctuation can collapse two distinct display names to the same
            # slug (for example ``A-B`` and ``A B``).  Preserve both accounts
            # with a deterministic hidden ID rather than allowing an ID map to
            # overwrite a peer.
            digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:8]
            ids[name] = f"{ids[name]}_{digest}"
    return assets, kinds, ids


def _first_names(names: Iterable[str], kinds: Mapping[str, str], *, kind: str, exclude_bitcoin: bool = False) -> list[str]:
    result = []
    for name in names:
        if kinds[name] == kind:
            result.append(name)
    return result


def _withdrawal_token(token: str) -> str:
    value = str(token).strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "traditional": "pre_tax",
        "pretax": "pre_tax",
        "401k": "pre_tax",
        "ira": "pre_tax",
        "tax_deferred": "pre_tax",
        "brokerage": "taxable",
        "stocks": "taxable",
        "bitcoin": "bitcoin",
        "crypto": "bitcoin",
        "rental_property": "rental",
        "property": "rental",
        "real_estate": "rental",
        "home": "primary",
        "primary_home": "primary",
        "rmd": "rmds",
    }
    return aliases.get(value, value)


def _default_withdrawal_order(params: Any) -> list[str]:
    order = getattr(params, "withdrawal_order", None)
    if order:
        return [_withdrawal_token(item) for item in order]
    return ["rmds", "taxable", "bitcoin", "pre_tax", "roth", "rental", "primary"]


def _validate_withdrawal_order(order: Sequence[str]) -> list[str]:
    normalized = [_withdrawal_token(item) for item in order]
    supported = {"rmds", "pre_tax", "taxable", "bitcoin", "roth", "rental", "primary"}
    if not normalized or any(item not in supported for item in normalized):
        raise ValueError("withdrawal_order contains an unsupported account category")
    if len(set(normalized)) != len(normalized):
        raise ValueError("withdrawal_order must not contain duplicates")
    if set(normalized) != supported:
        raise ValueError("withdrawal_order must include every supported account category exactly once")
    return normalized


@dataclass
class RunResult:
    timeline: list[dict[str, Any]]
    freedom_year: int | None
    is_success: bool
    first_failure_year: int | None
    stock_returns: list[float]
    nominal_net_worth: list[float]
    expenses: list[float]
    metadata: dict[str, Any]
    blocks: list[dict[str, Any]]


class AccountingCore:
    """One ledger implementation shared by all public endpoints."""

    def __init__(self, params: Any, *, mode: str, seed: int | None = None, run_index: int = 0) -> None:
        self.params = params
        self.mode = mode
        self.seed = DEFAULT_SEED if seed is None else int(seed)
        self.run_index = int(run_index)
        self.rng = random.Random(_seed_for_run(self.seed, run_index))
        self.assets, self.kinds, self.asset_ids = _classify_assets(params)
        self.names = [asset.name for asset in self.assets]
        self.portfolio: dict[str, float] = {}
        self.mortgage_balances: dict[str, float] = {}
        self.mortgage_payments_remaining: dict[str, int] = {}
        for asset in self.assets:
            value = _positive_or_zero(asset.value, field_name=f"assets.{asset.name}.value")
            if self.kinds[asset.name] == "real_estate":
                ownership = _finite(getattr(asset, "ownership_percentage", 1.0), field_name=f"assets.{asset.name}.ownership_percentage")
                if not 0.0 <= ownership <= 1.0:
                    raise ValueError(f"assets.{asset.name}.ownership_percentage must be between 0 and 1")
                self.portfolio[asset.name] = value * ownership
                self.mortgage_balances[asset.name] = _positive_or_zero(
                    getattr(asset, "mortgage_balance", 0.0),
                    field_name=f"assets.{asset.name}.mortgage_balance",
                )
                payments_remaining = int(getattr(asset, "mortgage_payments_remaining", 0) or 0)
                if payments_remaining < 0:
                    raise ValueError(f"assets.{asset.name}.mortgage_payments_remaining must be non-negative")
                self.mortgage_payments_remaining[asset.name] = payments_remaining
            else:
                self.portfolio[asset.name] = value
        self.withdrawal_order = _validate_withdrawal_order(_default_withdrawal_order(params))
        self.sale_haircut = _finite(getattr(params, "sale_haircut", DEFAULT_SALE_HAIRCUT), field_name="sale_haircut")
        self.property_sale_haircut = _finite(
            getattr(params, "property_sale_haircut", None)
            if getattr(params, "property_sale_haircut", None) is not None
            else self.sale_haircut,
            field_name="property_sale_haircut",
        )
        if not 0.0 <= self.sale_haircut < 1.0:
            raise ValueError("sale_haircut must be between 0 and 1")
        if not 0.0 <= self.property_sale_haircut < 1.0:
            raise ValueError("property_sale_haircut must be between 0 and 1")
        self.dividend_yield = _finite(getattr(params, "dividend_yield", DEFAULT_DIVIDEND_YIELD), field_name="dividend_yield")
        if not 0.0 <= self.dividend_yield <= 1.0:
            raise ValueError("dividend_yield must be between 0 and 1")
        self.tax_status = normalize_tax_status(getattr(params, "tax_filing_status", "married_joint"))
        self.tax_version = normalize_tax_version(getattr(params, "tax_version", "2025_simplified"))
        self.rmd_start_age = int(getattr(params, "rmd_start_age", 73))
        if self.rmd_start_age not in {73, 75}:
            raise ValueError("rmd_start_age must be 73 or 75")
        self.plan_through_age = int(getattr(params, "plan_through_age", 100))
        if not 85 <= self.plan_through_age <= 115:
            raise ValueError("plan_through_age must be between 85 and 115")
        current_age = int(params.current_age)
        retirement_age = int(params.target_retirement_age)
        if current_age > retirement_age or retirement_age > self.plan_through_age:
            raise ValueError("target_retirement_age must be between current_age and plan_through_age")
        sequence_seed = _seed_for_run(self.seed, self.run_index)
        self.return_sequence = _derive_return_sequence(
            params,
            mode=mode,
            seed=sequence_seed,
            intervals=max(0, self.plan_through_age - current_age),
        )
        self.blocks: list[dict[str, Any]] = []
        self.rental_initial = sum(
            value
            for name, value in self.portfolio.items()
            if self.kinds[name] == "real_estate" and not _is_primary(name, next(a for a in self.assets if a.name == name))
        )
        self.rental_remaining = self.rental_initial
        # The simple model does not map a rental-income stream to one named
        # property. Once a rental is sold, stop that stream from the following
        # modeled year instead of quietly paying a value-based fraction.
        self.rental_income_active = True
        # Income/property proceeds that cannot be assigned to a named liquid
        # account remain visible in this explicit cash reserve.  Keeping a
        # reserve prevents an all-or-nothing property sale or a surplus from
        # silently disappearing when a plan has no brokerage account.
        self.cash_reserve = 0.0

    def _block(self, code: str, message: str, *, path: str, age: int | None = None, item_id: str | None = None) -> dict[str, Any]:
        block = {"code": code, "message": message, "path": path}
        if age is not None:
            block["age"] = age
        if item_id is not None:
            block["id"] = item_id
        self.blocks.append(block)
        return block

    def _asset(self, name: str) -> Any:
        return next(asset for asset in self.assets if asset.name == name)

    def _add_cash(self, amount: float) -> None:
        amount = _positive_or_zero(amount, field_name="cash_reserve")
        self.cash_reserve = _finite(self.cash_reserve + amount, field_name="cash_reserve")

    def _property_equity(self, name: str) -> float:
        return _finite(
            self.portfolio[name] - self.mortgage_balances.get(name, 0.0),
            field_name=f"assets.{name}.property_equity",
        )

    def _property_equity_total(self, names: Iterable[str]) -> float:
        return _finite(sum(self._property_equity(name) for name in names), field_name="property_equity_total")

    def _derived_monthly_mortgage_payment(self, name: str) -> float:
        balance = self.mortgage_balances.get(name, 0.0)
        remaining = self.mortgage_payments_remaining.get(name, 0)
        if balance <= 0.0 or remaining <= 0:
            return 0.0
        asset = self._asset(name)
        configured = _positive_or_zero(
            getattr(asset, "mortgage_monthly_payment", 0.0),
            field_name=f"assets.{name}.mortgage_monthly_payment",
        )
        if configured > 0.0:
            return configured
        annual_rate = _finite(
            getattr(asset, "mortgage_interest_rate", 0.0),
            field_name=f"assets.{name}.mortgage_interest_rate",
        )
        if not 0.0 <= annual_rate <= 1.0:
            raise ValueError(f"assets.{name}.mortgage_interest_rate must be between 0 and 1")
        monthly_rate = annual_rate / 12.0
        if monthly_rate == 0.0:
            return balance / remaining
        return balance * monthly_rate / (1.0 - (1.0 + monthly_rate) ** -remaining)

    def _apply_mortgage_payments(self) -> tuple[float, list[dict[str, Any]]]:
        """Apply up to twelve property-specific P&I payments for this year."""

        total_paid = 0.0
        details: list[dict[str, Any]] = []
        for name in self.names:
            if self.kinds[name] != "real_estate":
                continue
            opening_balance = self.mortgage_balances.get(name, 0.0)
            opening_payments = self.mortgage_payments_remaining.get(name, 0)
            if opening_balance <= 1e-9 or opening_payments <= 0:
                continue
            asset = self._asset(name)
            annual_rate = _finite(
                getattr(asset, "mortgage_interest_rate", 0.0),
                field_name=f"assets.{name}.mortgage_interest_rate",
            )
            if not 0.0 <= annual_rate <= 1.0:
                raise ValueError(f"assets.{name}.mortgage_interest_rate must be between 0 and 1")
            monthly_rate = annual_rate / 12.0
            scheduled_payment = self._derived_monthly_mortgage_payment(name)
            balance = opening_balance
            remaining = opening_payments
            paid = 0.0
            interest_paid = 0.0
            principal_paid = 0.0
            largest_payment = 0.0
            for _ in range(min(12, opening_payments)):
                interest = balance * monthly_rate
                amount_due = balance + interest
                # The last declared payment clears any residual balance. This
                # keeps "payments remaining" authoritative even when a custom
                # payment amount is slightly inconsistent with the loan terms.
                payment = amount_due if remaining == 1 else min(scheduled_payment, amount_due)
                balance = max(0.0, amount_due - payment)
                principal = payment - interest
                paid += payment
                interest_paid += interest
                principal_paid += principal
                largest_payment = max(largest_payment, payment)
                remaining -= 1
                if balance <= 1e-9:
                    balance = 0.0
                    remaining = 0
                    break
            self.mortgage_balances[name] = _safe_balance(balance, name=f"mortgage.{name}")
            self.mortgage_payments_remaining[name] = max(0, remaining)
            total_paid += paid
            details.append({
                "asset": name,
                "asset_id": self.asset_ids[name],
                "opening_balance": opening_balance,
                "ending_balance": balance,
                "opening_payments_remaining": opening_payments,
                "ending_payments_remaining": max(0, remaining),
                "scheduled_monthly_payment": scheduled_payment,
                "largest_payment": largest_payment,
                "payment_total": paid,
                "principal_paid": principal_paid,
                "interest_paid": interest_paid,
            })
        return _finite(total_paid, field_name="mortgage_payment_total"), details

    def _property_cash_flow(self, inflation_multiplier: float) -> tuple[float, float, dict[str, float], list[dict[str, Any]]]:
        """Return ownership-adjusted cash flow for every unsold property.

        Property revenue and operating expenses are whole-property annual
        inputs. Both rise with the same global inflation path as the property's
        market value. Positive NOI is taxable rental income; negative NOI is
        essential spending.
        """

        rental_income = 0.0
        operating_shortfall = 0.0
        totals = {"gross_revenue": 0.0, "operating_expenses": 0.0, "net_operating_income": 0.0}
        details: list[dict[str, Any]] = []
        for name in self.names:
            if self.kinds[name] != "real_estate" or self.portfolio[name] <= 1e-9:
                continue
            asset = self._asset(name)
            ownership = _finite(getattr(asset, "ownership_percentage", 1.0), field_name=f"assets.{name}.ownership_percentage")
            whole_revenue = _positive_or_zero(getattr(asset, "annual_revenue", 0.0), field_name=f"assets.{name}.annual_revenue")
            whole_opex = _positive_or_zero(getattr(asset, "annual_operating_expenses", 0.0), field_name=f"assets.{name}.annual_operating_expenses")
            revenue = whole_revenue * ownership * inflation_multiplier
            opex = whole_opex * ownership * inflation_multiplier
            noi = revenue - opex
            if noi >= 0.0:
                rental_income += noi
            else:
                operating_shortfall += -noi
            totals["gross_revenue"] += revenue
            totals["operating_expenses"] += opex
            totals["net_operating_income"] += noi
            details.append({
                "asset": name,
                "asset_id": self.asset_ids[name],
                "property_role": getattr(asset, "property_role", None) or ("primary" if _is_primary(name, asset) else "rental"),
                "ownership_percentage": ownership,
                "gross_revenue": revenue,
                "operating_expenses": opex,
                "net_operating_income": noi,
            })
        return (
            _finite(rental_income, field_name="property_rental_income"),
            _finite(operating_shortfall, field_name="property_operating_shortfall"),
            {key: _finite(value, field_name=f"property_{key}") for key, value in totals.items()},
            details,
        )

    def _asset_return(self, name: str, market_return: float | None, property_inflation: float) -> float:
        asset = self._asset(name)
        kind = self.kinds[name]
        if kind == "real_estate":
            return property_inflation
        configured = _finite(asset.growth_rate, field_name=f"assets.{name}.growth_rate")
        if configured <= -1.0:
            raise ValueError(f"assets.{name}.growth_rate must be greater than -1")
        if self.mode == "historical" and kind not in {"real_estate", "bitcoin"}:
            assert market_return is not None
            return market_return
        if kind == "bitcoin":
            # Bitcoin retains its configured process in both modes; Historical
            # Monte Carlo adds its explicit volatility overlay below.
            return configured
        if market_return is not None and self.mode == "custom" and getattr(self.params, "custom_return_sequence", None):
            return market_return
        return configured

    def _apply_growth(self, age: int, property_inflation: float) -> tuple[dict[str, float], float]:
        changes = {name: 0.0 for name in self.names}
        if age == int(self.params.current_age):
            return changes, 0.0
        market_return = self.return_sequence.next() if self.return_sequence is not None else None
        # Volatility is applied only in stochastic mode.  A draw that would
        # make an asset non-positive is a visible calculation block; it is not
        # clamped to an arbitrary floor.
        for name in self.names:
            realized = self._asset_return(name, market_return, property_inflation)
            if not math.isfinite(realized) or realized <= -1.0:
                raise AccountingBlocked("RETURN_OUT_OF_RANGE", "A realized return would make an asset non-positive", path="return_source")
            before = self.portfolio[name]
            after = before * (1.0 + realized)
            if not math.isfinite(after):
                raise AccountingBlocked("NONFINITE_BALANCE", "A realized return produced a non-finite balance", path="portfolio")
            self.portfolio[name] = _safe_balance(after, name=name)
            changes[name] = after - before
        return changes, float(market_return or 0.0)

    def _apply_stochastic_overlay(self, *, stock_volatility: float, real_estate_volatility: float, names: Sequence[str], age: int) -> None:
        """Apply MC-only shocks to the interval already selected by the source.

        Historical stock returns stay contiguous and exact. Bitcoin uses the
        requested non-historical volatility; real estate follows inflation.
        """

        if self.mode != "historical" or age == int(self.params.current_age):
            return
        stock_sigma = _finite(stock_volatility, field_name="stock_volatility")
        _finite(real_estate_volatility, field_name="real_estate_volatility")
        for name in names:
            kind = self.kinds[name]
            if kind == "bitcoin":
                shock = self.rng.gauss(0.0, stock_sigma) if stock_sigma else 0.0
                realized = _finite(self._asset(name).growth_rate, field_name=f"assets.{name}.growth_rate") + shock
            else:
                continue
            if realized <= -1.0:
                raise AccountingBlocked("RETURN_OUT_OF_RANGE", "A stochastic return would make an asset non-positive", path="return_source")
            # The regular growth pass already applied the configured return to
            # Bitcoin. Replace that result with the requested
            # stochastic result without applying the value twice.
            configured = _finite(self._asset(name).growth_rate, field_name=f"assets.{name}.growth_rate")
            base = self.portfolio[name] / (1.0 + configured)
            self.portfolio[name] = _safe_balance(base * (1.0 + realized), name=name)

    def _one_time_assets(self, year: int, age: int) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for index, item in enumerate(getattr(self.params, "other_assets", []) or []):
            if int(item.add_year) != year:
                continue
            amount = _positive_or_zero(item.value, field_name=f"other_assets.{item.name}.value")
            item_id = _stable_id("other_asset", item, index)
            # A missing destination is routed to the first real account using
            # the documented liquid-first order.  The selected destination is
            # always returned on the row so the routing is never invisible;
            # callers can choose another account explicitly.
            destination = getattr(item, "destination_account", None) or getattr(item, "destination", None)
            if destination is None:
                destination = next(
                    (
                        name
                        for name in self.names
                        if self.kinds[name] == "taxable"
                    ),
                    None,
                )
                destination = destination or next((name for name in self.names if self.kinds[name] == "pre_tax"), None)
                destination = destination or next((name for name in self.names if self.kinds[name] == "roth"), None)
                destination = destination or next((name for name in self.names if self.kinds[name] in {"taxable", "bitcoin"}), None)
                destination = destination or next((name for name in self.names if self.kinds[name] == "real_estate"), None)
            destination_key = str(destination).strip().lower().replace("-", "_").replace(" ", "_") if destination is not None else None
            category_aliases = {"primary": "primary", "primary_home": "primary", "rental": "rental", "real_estate": "rental", "taxable": "taxable", "pre_tax": "pre_tax", "traditional": "pre_tax", "roth": "roth"}
            if destination_key in category_aliases:
                category = category_aliases[destination_key]
                target = next((name for name in self.names if self.kinds[name] == ("real_estate" if category in {"primary", "rental"} else category) and ((category != "primary") or _is_primary(name, self._asset(name))) and ((category != "rental") or not _is_primary(name, self._asset(name)))), None)
            else:
                target = next((name for name in self.names if name == destination or self.asset_ids.get(name) == destination), None)
            if target is None and amount <= 0:
                results.append({"id": item_id, "name": item.name, "requested_amount": amount, "applied_amount": 0.0, "destination_account": destination or "unresolved", "status": "not_applicable"})
                continue
            if target is None:
                self._block("ONE_TIME_ROUTE_UNAVAILABLE", "One-time asset has no matching destination account", path="other_assets.destination_account", age=age, item_id=item_id)
                results.append({"id": item_id, "name": item.name, "requested_amount": amount, "applied_amount": 0.0, "destination_account": destination or "unresolved", "status": "blocked"})
                continue
            _add(self.portfolio, target, amount)
            results.append({"id": item_id, "name": item.name, "requested_amount": amount, "applied_amount": amount, "destination_account": target, "status": "applied"})
        return results

    def _one_time_expenses(self, year: int, age: int) -> tuple[float, list[dict[str, Any]]]:
        total = 0.0
        results: list[dict[str, Any]] = []
        for index, item in enumerate(getattr(self.params, "one_time_expenses", []) or []):
            if int(item.year) != year:
                continue
            amount = _positive_or_zero(item.amount, field_name=f"one_time_expenses.{item.name}.amount")
            total += amount
            item_id = _stable_id("one_time_expense", item, index)
            destination = getattr(item, "destination_account", None)
            if getattr(item, "add_to_primary_home", False):
                destination = destination or "primary_home"
            destination = destination or "cash"
            destination_key = str(destination).strip().lower().replace("-", "_").replace(" ", "_")
            if destination_key in {"primary", "primary_home", "home"}:
                destination = "primary_home"
            elif destination_key in {"rental", "rental_property", "real_estate", "property"}:
                destination = "rental"
            elif destination_key in {"traditional", "pre_tax", "pretax", "401k"}:
                destination = "pre_tax"
            elif destination_key in {"roth", "roth_ira"}:
                destination = "roth"
            elif destination_key == "brokerage":
                destination = "taxable"
            status = "scheduled"
            if destination == "primary_home":
                target = next((name for name in self.names if self.kinds[name] == "real_estate" and _is_primary(name, self._asset(name))), None)
                if target is None:
                    self._block("ONE_TIME_ROUTE_UNAVAILABLE", "One-time expense requested primary-home routing but no primary home exists", path="one_time_expenses.destination_account", age=age, item_id=item_id)
                    status = "blocked"
                else:
                    # Preserve the historical UI behavior: a home-directed
                    # one-time amount is recorded as home equity while the
                    # expense remains visible in cash needs.
                    _add(self.portfolio, target, amount)
                    status = "routed_to_home"
            elif destination != "cash":
                if destination == "rental":
                    target = next((name for name in self.names if self.kinds[name] == "real_estate" and not _is_primary(name, self._asset(name))), None)
                elif destination == "primary_home":
                    target = next((name for name in self.names if self.kinds[name] == "real_estate" and _is_primary(name, self._asset(name))), None)
                else:
                    target = next((name for name in self.names if name == destination or self.asset_ids.get(name) == destination), None)
                if target is None:
                    self._block("ONE_TIME_ROUTE_UNAVAILABLE", "One-time expense destination account does not exist", path="one_time_expenses.destination_account", age=age, item_id=item_id)
                    status = "blocked"
                else:
                    status = "routed_to_account"
            results.append({"id": item_id, "name": item.name, "requested_amount": amount, "applied_amount": amount if status != "blocked" else 0.0, "destination": destination, "status": status})
        return _finite(total, field_name="one_time_expenses_total"), results

    def _income(
        self,
        year: int,
        age: int,
        inflation_for_year: float,
        inflation_multiplier: float,
        years_passed: int,
        rental_pct: float,
    ) -> tuple[dict[str, float], dict[str, float], list[dict[str, Any]]]:
        tracker = {
            "w2_income": 0.0,
            "rental_income": 0.0,
            "royalty_income": 0.0,
            "dividend_income": 0.0,
            "social_security": 0.0,
            "retirement_withdrawals": 0.0,
            "brokerage_withdrawals": 0.0,
            "bitcoin_withdrawals": 0.0,
            "roth_withdrawals": 0.0,
            "other_income": 0.0,
        }
        ids: dict[str, float] = {}
        details: list[dict[str, Any]] = []
        for index, stream in enumerate(getattr(self.params, "inflows", []) or []):
            if int(stream.start_year) <= year <= int(stream.end_year):
                name_lower = stream.name.lower()
                explicit_type = getattr(stream, "income_type", None)
                is_w2 = explicit_type == "w2" or (explicit_type is None and ("w2" in name_lower or "salary" in name_lower))
                # Retirement age is the first full retirement year.  A stale
                # salary end date must not keep paying or matching after that
                # point.
                if is_w2 and age >= int(getattr(self.params, "target_retirement_age", age + 1)):
                    continue
                use_global_growth = getattr(stream, "growth_mode", "custom") == "global" or stream.growth_rate is None
                rate = inflation_for_year if use_global_growth else _finite(stream.growth_rate, field_name=f"inflows.{stream.name}.growth_rate")
                if rate <= -1.0:
                    raise ValueError(f"inflows.{stream.name}.growth_rate must be greater than -1")
                amount = _positive_or_zero(stream.amount, field_name=f"inflows.{stream.name}.amount") * (
                    inflation_multiplier if use_global_growth else (1.0 + rate) ** years_passed
                )
                if is_w2:
                    category = "w2_income"
                elif explicit_type == "rental" or (explicit_type is None and "rental" in name_lower):
                    category = "rental_income"
                    amount *= rental_pct
                elif explicit_type == "royalty" or (explicit_type is None and "royalt" in name_lower):
                    category = "royalty_income"
                elif explicit_type == "social_security" or (explicit_type is None and "social" in name_lower):
                    category = "social_security"
                else:
                    category = "other_income"
                tracker[category] += amount
                ids[_stable_id("inflow", stream, index)] = amount
                details.append({"id": _stable_id("inflow", stream, index), "name": stream.name, "amount": amount, "category": category})
        return tracker, ids, details

    def _rmd(
        self,
        age: int,
        prior_dec31_balance: float,
        *,
        employed: bool = False,
        prior_dec31_by_account: Mapping[str, float] | None = None,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        all_pretax_names = _first_names(self.names, self.kinds, kind="pre_tax")
        # A workplace plan is delayed while employment income is present.  An
        # IRA or a retired former workplace account remains RMD-eligible.
        pretax_names = [
            name for name in all_pretax_names
            if not (employed and _is_workplace_plan(self._asset(name)))
        ]
        divisor = get_rmd_divisor(age, self.rmd_start_age)
        if prior_dec31_by_account is not None:
            source = _sum_values(prior_dec31_by_account, pretax_names) if pretax_names else 0.0
        else:
            source = _finite(prior_dec31_balance, field_name="rmd_source_balance")
        required = source / divisor if divisor else 0.0
        applied = 0.0
        applied_by_account: dict[str, float] = {name: 0.0 for name in pretax_names}
        if required > 0 and pretax_names:
            available = _sum_values(self.portfolio, pretax_names)
            applied = min(required, available)
            # Allocate proportionally with a stable account order.
            remaining = applied
            for position, name in enumerate(pretax_names):
                amount = available and (applied * self.portfolio[name] / available) or 0.0
                if position == len(pretax_names) - 1:
                    amount = remaining
                amount = min(self.portfolio[name], max(0.0, amount))
                _remove(self.portfolio, name, amount)
                applied_by_account[name] = amount
                remaining -= amount
            if remaining > 1e-8:
                raise AccountingBlocked("RMD_ALLOCATION", "RMD could not be allocated across pre-tax accounts", path="rmd")
        shortfall = max(0.0, required - applied)
        metadata = {
            "eligible": bool(divisor),
            "start_age": self.rmd_start_age,
            "timing": "prior_december_31_balance",
            "prior_december_31_balance": source,
            "divisor": divisor or None,
            "required_amount": required,
            "applied_amount": applied,
            "shortfall_amount": shortfall,
            "accounts": pretax_names,
            "account_amounts": applied_by_account,
            "excluded_workplace_accounts": [name for name in all_pretax_names if name not in pretax_names],
            "workplace_delay": bool(employed and any(name not in pretax_names for name in all_pretax_names)),
        }
        if shortfall > 1e-8 and divisor:
            self._block("RMD_UNFUNDED", "Required minimum distribution exceeded available pre-tax assets", path="rmd", age=age)
        return {"retirement_withdrawals": applied}, metadata

    def _dividends(self, age: int) -> tuple[float, dict[str, float], dict[str, float]]:
        taxable_dividends = 0.0
        reinvested: dict[str, float] = {name: 0.0 for name in self.names}
        by_account: dict[str, float] = {name: 0.0 for name in self.names}
        for name in self.names:
            asset_yield = getattr(self._asset(name), "dividend_yield", None)
            yield_rate = self.dividend_yield if asset_yield is None else _finite(asset_yield, field_name=f"assets.{name}.dividend_yield")
            amount = self.portfolio[name] * yield_rate
            if amount <= 0:
                continue
            kind = self.kinds[name]
            if kind in {"pre_tax", "roth"}:
                _add(self.portfolio, name, amount)
                reinvested[name] = amount
            elif kind == "taxable":
                taxable_dividends += amount
                by_account[name] = amount
        return taxable_dividends, reinvested, by_account

    def _taxable_social_security(self, benefit: float, other_ordinary_income: float) -> float:
        configured_fraction = getattr(self.params, "social_security_taxable_fraction", None)
        if configured_fraction is None:
            return _social_security_taxable_amount(benefit, other_ordinary_income, self.tax_status)
        fraction = _finite(configured_fraction, field_name="social_security_taxable_fraction")
        if not 0.0 <= fraction <= 1.0:
            raise ValueError("social_security_taxable_fraction must be between 0 and 1")
        return max(0.0, benefit) * fraction

    def _federal_tax_for_income(
        self,
        other_ordinary_income: float,
        social_security: float,
        *,
        years_passed: int,
        inflation: float,
        inflation_factor: float | None = None,
    ) -> tuple[float, float, float]:
        """Return tax, taxable Social Security, and total ordinary income.

        Social Security taxability depends on the other income in the same
        year.  Keeping that dependency in one helper ensures a discretionary
        pre-tax withdrawal cannot raise provisional income without also
        raising the modeled taxable portion of the benefit.
        """

        other = max(0.0, _finite(other_ordinary_income, field_name="ordinary_income"))
        benefit = max(0.0, _finite(social_security, field_name="social_security"))
        taxable_social_security = self._taxable_social_security(benefit, other)
        ordinary_income = other + taxable_social_security
        tax = calculate_federal_tax(
            ordinary_income,
            years_passed=years_passed,
            inflation=inflation,
            tax_filing_status=self.tax_status,
            tax_version=self.tax_version,
            inflation_factor=inflation_factor,
        )
        return tax, taxable_social_security, ordinary_income

    def _sale_haircut_net(self, gross: float, haircut: float) -> float:
        return gross * (1.0 - haircut)

    def _pretax_net_from_gross(
        self,
        gross: float,
        *,
        base_ordinary_income: float,
        social_security: float = 0.0,
        years_passed: int,
        inflation: float,
        inflation_factor: float | None = None,
    ) -> float:
        """Return the incremental after-tax cash from a pre-tax withdrawal."""

        gross = max(0.0, _finite(gross, field_name="pre_tax_withdrawal"))
        base = max(0.0, _finite(base_ordinary_income, field_name="ordinary_income"))
        if gross == 0.0:
            return 0.0
        base_tax, _, _ = self._federal_tax_for_income(
            base,
            social_security,
            years_passed=years_passed,
            inflation=inflation,
            inflation_factor=inflation_factor,
        )
        total_tax, _, _ = self._federal_tax_for_income(
            base + gross,
            social_security,
            years_passed=years_passed,
            inflation=inflation,
            inflation_factor=inflation_factor,
        )
        return max(0.0, gross - max(0.0, total_tax - base_tax))

    def _pretax_gross_for_net(
        self,
        needed: float,
        *,
        base_ordinary_income: float,
        social_security: float = 0.0,
        years_passed: int,
        inflation: float,
        inflation_factor: float | None = None,
    ) -> float:
        """Solve the pre-tax gross-up iteratively for the requested net cash."""

        needed = max(0.0, _finite(needed, field_name="pre_tax_net_need"))
        if needed == 0.0:
            return 0.0
        # A bracket is expanded instead of assuming a fixed marginal rate;
        # this handles standard-deduction boundaries and all simplified tax
        # brackets without underfunding a requested expense.
        low = 0.0
        high = max(needed, needed / (1.0 - PRE_TAX_WITHDRAWAL_TAX_RATE))
        for _ in range(32):
            if self._pretax_net_from_gross(
                high,
                base_ordinary_income=base_ordinary_income,
                social_security=social_security,
                years_passed=years_passed,
                inflation=inflation,
                inflation_factor=inflation_factor,
            ) >= needed:
                break
            high *= 2.0
        if self._pretax_net_from_gross(
            high,
            base_ordinary_income=base_ordinary_income,
            social_security=social_security,
            years_passed=years_passed,
            inflation=inflation,
            inflation_factor=inflation_factor,
        ) < needed:
            raise AccountingBlocked("PRETAX_GROSS_UP_FAILED", "Pre-tax withdrawal could not be grossed up safely", path="withdrawal_order")
        for _ in range(60):
            midpoint = (low + high) / 2.0
            if self._pretax_net_from_gross(
                midpoint,
                base_ordinary_income=base_ordinary_income,
                social_security=social_security,
                years_passed=years_passed,
                inflation=inflation,
                inflation_factor=inflation_factor,
            ) >= needed:
                high = midpoint
            else:
                low = midpoint
        return high

    def _withdraw(
        self,
        needed: float,
        age: int,
        retirement_age: int,
        *,
        order: Sequence[str],
        base_ordinary_income: float = 0.0,
        social_security: float = 0.0,
        years_passed: int = 0,
        inflation: float = 0.0,
        inflation_factor: float | None = None,
    ) -> tuple[dict[str, float], list[dict[str, Any]], float, float]:
        requested = max(0.0, needed)
        remaining = requested
        withdrawn = {name: 0.0 for name in self.names}
        details: list[dict[str, Any]] = []
        pretax_drawn = 0.0
        if self.cash_reserve > 0.0 and remaining > 1e-9:
            used = min(self.cash_reserve, remaining)
            self.cash_reserve -= used
            remaining -= used
            details.append({"category": "cash_reserve", "asset": "__cash_reserve__", "gross": used, "net": used, "haircut": 0.0})
        for category in order:
            if remaining <= 1e-9:
                break
            if category == "pre_tax":
                if age < int(getattr(self.params, "retirement_withdrawal_age", retirement_age)):
                    self._block("WITHDRAWAL_BLOCKED", "Pre-tax withdrawals are unavailable before the configured withdrawal age", path="withdrawal_order", age=age)
                    continue
                names = _first_names(self.names, self.kinds, kind="pre_tax")
                for name in names:
                    if remaining <= 1e-9:
                        break
                    gross_need = self._pretax_gross_for_net(
                        remaining,
                        base_ordinary_income=base_ordinary_income + pretax_drawn,
                        social_security=social_security,
                        years_passed=years_passed,
                        inflation=inflation,
                        inflation_factor=inflation_factor,
                    )
                    gross = min(self.portfolio[name], gross_need)
                    net = self._pretax_net_from_gross(
                        gross,
                        base_ordinary_income=base_ordinary_income + pretax_drawn,
                        social_security=social_security,
                        years_passed=years_passed,
                        inflation=inflation,
                        inflation_factor=inflation_factor,
                    )
                    _remove(self.portfolio, name, gross)
                    withdrawn[name] += gross
                    pretax_drawn += gross
                    remaining -= net
                    details.append({"category": category, "asset": name, "gross": gross, "net": net, "haircut": "iterative_federal_tax"})
            elif category in {"taxable", "bitcoin"}:
                if category == "bitcoin":
                    names = [name for name in self.names if self.kinds[name] == "bitcoin"]
                else:
                    names = [name for name in self.names if self.kinds[name] == "taxable"]
                for name in names:
                    if remaining <= 1e-9:
                        break
                    gross = min(self.portfolio[name], remaining / (1.0 - self.sale_haircut))
                    net = self._sale_haircut_net(gross, self.sale_haircut)
                    _remove(self.portfolio, name, gross)
                    withdrawn[name] += gross
                    remaining -= net
                    details.append({"category": category, "asset": name, "gross": gross, "net": net, "haircut": self.sale_haircut})
            elif category == "roth":
                for name in _first_names(self.names, self.kinds, kind="roth"):
                    if remaining <= 1e-9:
                        break
                    gross = min(self.portfolio[name], remaining)
                    _remove(self.portfolio, name, gross)
                    withdrawn[name] += gross
                    remaining -= gross
                    details.append({"category": category, "asset": name, "gross": gross, "net": gross, "haircut": 0.0})
            elif category in {"rental", "primary"}:
                if category == "primary" and not bool(getattr(self.params, "allow_primary_home_sale", True)):
                    self._block("PROPERTY_SALE_BLOCKED", "Primary-home sale is disabled", path="allow_primary_home_sale", age=age)
                    continue
                if category == "rental" and not bool(getattr(self.params, "allow_property_sale", True)):
                    self._block("PROPERTY_SALE_BLOCKED", "Property sale is disabled", path="allow_property_sale", age=age)
                    continue
                candidates = [name for name in self.names if self.kinds[name] == "real_estate" and (_is_primary(name, self._asset(name)) == (category == "primary"))]
                for name in candidates:
                    if remaining <= 1e-9:
                        break
                    value = self.portfolio[name]
                    if value <= 1e-9:
                        continue
                    # Property sales are all-or-nothing: never sell a fraction
                    # merely to satisfy the remaining amount. Sale proceeds
                    # use only the user's owned share and must first retire the
                    # mortgage tied to this property.
                    haircut_amount = value * self.property_sale_haircut
                    mortgage_payoff = self.mortgage_balances.get(name, 0.0)
                    net = max(0.0, value - haircut_amount - mortgage_payoff)
                    if net <= 1e-9:
                        self._block("PROPERTY_NO_NET_PROCEEDS", "Property has no net sale proceeds after its mortgage and sale haircut", path="assets.mortgage_balance", age=age, item_id=self.asset_ids[name])
                        continue
                    _remove(self.portfolio, name, value)
                    self.mortgage_balances[name] = 0.0
                    self.mortgage_payments_remaining[name] = 0
                    withdrawn[name] += value
                    if not _is_primary(name, self._asset(name)):
                        self.rental_remaining = max(0.0, self.rental_remaining - value)
                        self.rental_income_active = False
                    consumed = min(max(0.0, remaining), net)
                    proceeds_excess = max(0.0, net - consumed)
                    if proceeds_excess > 1e-9:
                        destination = next(
                            (
                                candidate
                                for candidate in self.names
                                if self.kinds[candidate] in {"pre_tax", "roth", "taxable", "bitcoin"}
                            ),
                            None,
                        )
                        if destination is not None:
                            _add(self.portfolio, destination, proceeds_excess)
                        else:
                            self._add_cash(proceeds_excess)
                    remaining = max(0.0, remaining - net)
                    details.append({"category": category, "asset": name, "gross": value, "net": net, "haircut": self.property_sale_haircut, "haircut_amount": haircut_amount, "mortgage_payoff": mortgage_payoff, "all_or_nothing": True, "excess_proceeds": proceeds_excess, "excess_destination": destination if proceeds_excess > 1e-9 else None})
        funded = requested - max(0.0, remaining)
        return withdrawn, details, funded, max(0.0, remaining)

    def run(self, *, stock_volatility: float = 0.0, real_estate_volatility: float = 0.0, inflation_volatility: float = 0.0) -> RunResult:
        current_year = int(self.params.current_year)
        current_age = int(self.params.current_age)
        retirement_age = int(self.params.target_retirement_age)
        base_inflation = _finite(self.params.general_inflation, field_name="general_inflation")
        if base_inflation <= -1.0:
            raise ValueError("general_inflation must be greater than -1")
        infl_vol = _finite(inflation_volatility, field_name="inflation_volatility")
        if infl_vol < 0:
            raise ValueError("inflation_volatility must be non-negative")
        stock_vol = _finite(stock_volatility, field_name="stock_volatility")
        re_vol = _finite(real_estate_volatility, field_name="real_estate_volatility")
        if stock_vol < 0 or re_vol < 0:
            raise ValueError("volatility values must be non-negative")

        timeline: list[dict[str, Any]] = []
        stock_returns: list[float] = []
        nominal_net_worth: list[float] = []
        expenses_series: list[float] = []
        freedom_year: int | None = None
        first_failure_year: int | None = None
        prior_dec31_pretax_names = _first_names(self.names, self.kinds, kind="pre_tax")
        prior_dec31_pretax = _sum_values(self.portfolio, prior_dec31_pretax_names) if prior_dec31_pretax_names else 0.0
        prior_dec31_by_account = {name: self.portfolio[name] for name in prior_dec31_pretax_names}
        ever_unfunded_before_plan_end = False
        last_stock_return = 0.0
        spending_reduction_years = 0
        spending_reduction_pct = 0.0
        inflation_multiplier = 1.0
        rules = sorted(
            list(getattr(self.params, "spending_rules", []) or []),
            key=lambda item: float(getattr(item, "stock_down_threshold", 0.0)),
            reverse=True,
        )

        for age in range(current_age, self.plan_through_age + 1):
            year = current_year + age - current_age
            years_passed = age - current_age
            inflation_for_year = base_inflation
            if self.mode == "historical" and infl_vol:
                inflation_for_year = self.rng.gauss(base_inflation, infl_vol)
                if inflation_for_year <= -1.0:
                    raise AccountingBlocked("INFLATION_OUT_OF_RANGE", "A stochastic inflation draw would be invalid", path="inflation_volatility")
            if age > current_age:
                inflation_multiplier *= 1.0 + inflation_for_year
            inflation_mult = inflation_multiplier

            opening = dict(self.portfolio)
            opening["__cash_reserve__"] = self.cash_reserve
            opening_mortgage_balances = dict(self.mortgage_balances)
            growth_changes, stock_return = self._apply_growth(age, inflation_for_year)
            # MC overlays are applied to non-stock processes after the common
            # growth transition, keeping the stock sequence shared by all
            # endpoints.
            self._apply_stochastic_overlay(stock_volatility=stock_vol, real_estate_volatility=re_vol, names=self.names, age=age)
            # The overlay replaces the configured return for Bitcoin.
            # Recompute the displayed deltas so charts and exports
            # describe the realized ledger transition, not the pre-overlay
            # placeholder growth.
            if age > current_age:
                for name in self.names:
                    growth_changes[name] = self.portfolio[name] - opening[name]
            if age > current_age and self.return_sequence is not None:
                last_stock_return = stock_return
            stock_returns.append(float(last_stock_return if age > current_age else 0.0))

            one_time_asset_details = self._one_time_assets(year, age)
            one_time_total, one_time_expense_details = self._one_time_expenses(year, age)
            mortgage_payment_total, mortgage_details = self._apply_mortgage_payments()
            property_rental_income, property_operating_shortfall, property_cash_totals, property_cash_details = self._property_cash_flow(inflation_multiplier)
            mortgage_by_asset_id = {str(item["asset_id"]): float(item["payment_total"]) for item in mortgage_details}
            rental_debt_service_total = 0.0
            rental_operating_shortfall = 0.0
            rental_property_noi = 0.0
            for detail in property_cash_details:
                debt_service = mortgage_by_asset_id.get(str(detail["asset_id"]), 0.0)
                detail["debt_service"] = debt_service
                detail["cash_flow_after_debt_service"] = float(detail["net_operating_income"]) - debt_service
                if detail["property_role"] != "primary":
                    rental_debt_service_total += debt_service
                    rental_property_noi += float(detail["net_operating_income"])
                    rental_operating_shortfall += max(0.0, -float(detail["net_operating_income"]))

            # A spending rule reacts to the prior interval's market return and
            # affects the current year only.  Values are validated, never clamped.
            triggered = None
            for rule in rules:
                threshold = _finite(getattr(rule, "stock_down_threshold", 0.0), field_name="spending_rules.stock_down_threshold")
                reduction = _finite(getattr(rule, "reduce_spending_pct", 0.0), field_name="spending_rules.reduce_spending_pct")
                duration = int(getattr(rule, "years", 0))
                if threshold < 0 or reduction < 0 or reduction > 1 or duration < 0:
                    raise ValueError("spending rules contain an invalid threshold, reduction or duration")
                if age > current_age and last_stock_return <= -threshold and threshold > 0 and reduction > 0 and duration > 0:
                    triggered = rule
                    break
            if triggered is not None:
                spending_reduction_pct = float(triggered.reduce_spending_pct)
                spending_reduction_years = int(triggered.years)
            recurring_multiplier = 1.0 - spending_reduction_pct if spending_reduction_years > 0 else 1.0

            # Mortgage P&I is tied to each property and is essential spending;
            # adaptive spending rules never reduce a contractual loan payment.
            target_expenses = one_time_total + mortgage_payment_total + property_operating_shortfall
            outflow_by_id: dict[str, float] = {}
            outflow_details: list[dict[str, Any]] = []
            for index, outflow in enumerate(getattr(self.params, "outflows", []) or []):
                if int(outflow.start_year) <= year <= int(outflow.end_year):
                    use_global_growth = getattr(outflow, "growth_mode", "custom") == "global" or outflow.growth_rate is None
                    rate = inflation_for_year if use_global_growth else _finite(outflow.growth_rate, field_name=f"outflows.{outflow.name}.growth_rate")
                    if rate <= -1.0:
                        raise ValueError(f"outflows.{outflow.name}.growth_rate must be greater than -1")
                    spending_multiplier = recurring_multiplier if bool(getattr(outflow, "discretionary", True)) else 1.0
                    amount = _positive_or_zero(outflow.amount, field_name=f"outflows.{outflow.name}.amount") * (
                        inflation_multiplier if use_global_growth else (1.0 + rate) ** years_passed
                    ) * spending_multiplier
                    target_expenses += amount
                    item_id = _stable_id("outflow", outflow, index)
                    outflow_by_id[item_id] = amount
                    outflow_details.append({
                        "id": item_id,
                        "name": outflow.name,
                        "amount": amount,
                        "growth_mode": "global" if use_global_growth else "custom",
                        "discretionary": bool(getattr(outflow, "discretionary", True)),
                    })

            rental_pct = 1.0 if self.rental_income_active else 0.0
            tracker, income_by_id, income_details = self._income(year, age, inflation_for_year, inflation_multiplier, years_passed, rental_pct)
            legacy_rental_income = tracker["rental_income"]
            tracker["rental_income"] += property_rental_income
            rental_cash_flow_before_tax = legacy_rental_income + rental_property_noi - rental_debt_service_total
            for detail in property_cash_details:
                amount = max(0.0, float(detail["net_operating_income"]))
                if amount <= 0.0:
                    continue
                item_id = f"property_income_{detail['asset_id']}"
                income_by_id[item_id] = amount
                income_details.append({"id": item_id, "name": detail["asset"], "amount": amount, "category": "rental_income"})

            employee_contribution = 0.0
            employer_match = 0.0
            contribution_destination = None
            if tracker["w2_income"] > 0 and age < retirement_age:
                configured_limit = _positive_or_zero(
                    getattr(self.params, "workplace_contribution_limit", 24500.0),
                    field_name="workplace_contribution_limit",
                )
                contribution_limit = configured_limit * ((1.0 + base_inflation) ** years_passed)
                match_cap_rate = _finite(
                    getattr(self.params, "employer_match_rate", 0.13),
                    field_name="employer_match_rate",
                )
                if not 0.0 <= match_cap_rate <= 1.0:
                    raise ValueError("employer_match_rate must be between 0 and 1")
                employee_contribution = min(tracker["w2_income"], contribution_limit)
                # The approved default is a 100% match, capped at 13% of W-2
                # pay.  The legacy wire field stores that cap as a fraction,
                # so a $1 employee contribution earns $1 until the cap.
                employer_match = min(employee_contribution, tracker["w2_income"] * match_cap_rate)
                pretax_names = _first_names(self.names, self.kinds, kind="pre_tax")
                if pretax_names:
                    _add(self.portfolio, pretax_names[0], employee_contribution + employer_match)
                    contribution_destination = pretax_names[0]
                else:
                    # Keep the contribution and match visible even when an
                    # imported plan has no pre-tax account. A taxable account,
                    # Roth account, or the explicit cash reserve is a safe,
                    # deterministic fallback; nothing is silently discarded.
                    fallback = next((name for name in self.names if self.kinds[name] == "taxable"), None)
                    fallback = fallback or next((name for name in self.names if self.kinds[name] == "roth"), None)
                    if fallback:
                        _add(self.portfolio, fallback, employee_contribution + employer_match)
                        contribution_destination = fallback
                    else:
                        self._add_cash(employee_contribution + employer_match)
                        contribution_destination = "__cash_reserve__"

            taxable_dividend, dividend_reinvestment, dividend_by_account = self._dividends(age)
            tracker["dividend_income"] = taxable_dividend
            rmd_income, rmd_metadata = self._rmd(
                age,
                prior_dec31_pretax,
                employed=tracker["w2_income"] > 0,
                prior_dec31_by_account=prior_dec31_by_account,
            )
            rmd_withdrawal_amount = float(rmd_income["retirement_withdrawals"])
            tracker["retirement_withdrawals"] += rmd_withdrawal_amount
            if float(rmd_metadata.get("shortfall_amount", 0.0)) > 1e-9:
                ever_unfunded_before_plan_end = True
                if first_failure_year is None:
                    first_failure_year = year

            other_ordinary_income = (
                tracker["w2_income"] - employee_contribution
                + tracker["rental_income"]
                + tracker["royalty_income"]
                + tracker["dividend_income"]
                + tracker["retirement_withdrawals"]
                + tracker["other_income"]
            )
            income_tax, taxable_social_security, ordinary_income = self._federal_tax_for_income(
                other_ordinary_income,
                tracker["social_security"],
                years_passed=years_passed,
                inflation=base_inflation,
                inflation_factor=inflation_multiplier,
            )
            # Cash income is not the same thing as taxable income.  In
            # particular, the standard Social Security rule may leave 0%,
            # 50%, or 15% of a benefit outside ordinary income while the
            # entire gross benefit is still available to pay spending.  Keep
            # that non-taxable cash visible instead of silently requiring an
            # unnecessary portfolio draw.
            cash_income_before_tax = (
                tracker["w2_income"] - employee_contribution
                + tracker["rental_income"]
                + tracker["royalty_income"]
                + tracker["dividend_income"]
                + tracker["social_security"]
                + tracker["retirement_withdrawals"]
                + tracker["other_income"]
            )
            mandatory_net = cash_income_before_tax - income_tax
            surplus = mandatory_net - target_expenses
            # A plan can need portfolio cash before the retirement date too
            # (for example, a career break or a large one-time expense). Do
            # not silently ignore that gap; the configured order will use
            # available liquid accounts and visibly block if it cannot fund it.
            requested_withdrawal = max(0.0, -surplus)
            withdrawals, withdrawal_details, funded_withdrawal, withdrawal_shortfall = self._withdraw(
                requested_withdrawal,
                age,
                retirement_age,
                order=self.withdrawal_order,
                base_ordinary_income=other_ordinary_income,
                social_security=tracker["social_security"],
                years_passed=years_passed,
                inflation=base_inflation,
                inflation_factor=inflation_multiplier,
            )
            if requested_withdrawal and withdrawal_shortfall > 1e-9:
                self._block("WITHDRAWAL_UNFUNDED", "Configured withdrawal order could not fund the spending need", path="withdrawal_order", age=age)
            for name, amount in withdrawals.items():
                kind = self.kinds[name]
                if kind == "pre_tax":
                    tracker["retirement_withdrawals"] += amount
                elif kind == "roth":
                    tracker["roth_withdrawals"] += amount
                elif kind == "bitcoin":
                    tracker["bitcoin_withdrawals"] += amount
                elif kind == "taxable":
                    tracker["brokerage_withdrawals"] += amount
                elif kind == "real_estate":
                    tracker["brokerage_withdrawals"] += amount

            # Recompute ordinary tax after any pre-tax discretionary draw.
            final_other_ordinary_income = max(
                0.0,
                tracker["w2_income"] - employee_contribution
                + tracker["rental_income"] + tracker["royalty_income"] + tracker["dividend_income"]
                + tracker["retirement_withdrawals"] + tracker["other_income"],
            )
            final_income_tax, taxable_social_security, final_ordinary_income = self._federal_tax_for_income(
                final_other_ordinary_income,
                tracker["social_security"],
                years_passed=years_passed,
                inflation=base_inflation,
                inflation_factor=inflation_multiplier,
            )
            ss_fraction = taxable_social_security / tracker["social_security"] if tracker["social_security"] > 0 else 0.0
            sale_haircut_total = sum(
                max(0.0, float(detail.get("haircut_amount", float(detail.get("gross", 0.0)) - float(detail.get("net", 0.0)) - float(detail.get("mortgage_payoff", 0.0)))))
                for detail in withdrawal_details
                if detail.get("category") in {"taxable", "bitcoin", "rental", "primary"}
            )
            tax_total = final_income_tax + sale_haircut_total
            # ``funded_withdrawal`` is the net cash actually consumed by this
            # year's spending (property excess proceeds stay in the ledger).
            # It already includes the incremental tax cost of a pre-tax
            # gross-up, so subtracting ``final_income_tax`` here would count
            # that incremental tax a second time.  Use the pre-discretionary
            # tax bill as the base and add the net proceeds of the configured
            # withdrawal sources.
            cash_income_after_tax = cash_income_before_tax - income_tax + funded_withdrawal

            surplus_destination = None
            if surplus >= 0 and surplus > 0:
                # Reinvest excess cash in a named liquid account when one is
                # available. If the plan contains only property, retain it in
                # the explicit cash reserve rather than dropping it or raising
                # a misleading calculation block.
                target = next((name for name in self.names if self.kinds[name] == "taxable"), None)
                target = target or next((name for name in self.names if self.kinds[name] == "pre_tax"), None)
                target = target or next((name for name in self.names if self.kinds[name] == "roth"), None)
                if target:
                    _add(self.portfolio, target, surplus)
                    surplus_destination = target
                else:
                    self._add_cash(surplus)
                    surplus_destination = "__cash_reserve__"

            # Keep required-distribution reporting separate from any later
            # discretionary pre-tax draw. Additional pre-tax money withdrawn
            # in an RMD-eligible year is shown as excess rather than inflating
            # the amount credited toward the requirement.
            rmd_required_amount = float(rmd_metadata.get("required_amount", 0.0))
            total_pre_tax_withdrawal = float(tracker["retirement_withdrawals"])
            rmd_metadata["used_amount"] = min(total_pre_tax_withdrawal, rmd_required_amount) if rmd_required_amount > 0 else 0.0
            rmd_metadata["excess_amount"] = max(0.0, total_pre_tax_withdrawal - rmd_required_amount) if rmd_required_amount > 0 else 0.0
            fully_funded = requested_withdrawal <= 1e-9 or withdrawal_shortfall <= 1e-9
            if not fully_funded:
                ever_unfunded_before_plan_end = True
                if first_failure_year is None:
                    first_failure_year = year

            # Passive-income freedom remains a display metric, but is now based
            # on the final tax calculation and the visible annual need.
            passive_gross = tracker["rental_income"] + tracker["dividend_income"] + tracker["royalty_income"] + tracker["social_security"] + tracker["retirement_withdrawals"]
            if freedom_year is None and passive_gross - final_income_tax >= target_expenses:
                freedom_year = year

            ending = dict(self.portfolio)
            ending["__cash_reserve__"] = self.cash_reserve
            liquid_names = [name for name in self.names if self.kinds[name] in {"pre_tax", "roth", "taxable", "bitcoin"}]
            rental_names = [name for name in self.names if self.kinds[name] == "real_estate" and not _is_primary(name, self._asset(name))]
            primary_names = [name for name in self.names if self.kinds[name] == "real_estate" and _is_primary(name, self._asset(name))]
            asset_breakdown = {
                "retirement_traditional": _sum_values(self.portfolio, _first_names(self.names, self.kinds, kind="pre_tax")) if _first_names(self.names, self.kinds, kind="pre_tax") else 0.0,
                "retirement_roth": _sum_values(self.portfolio, _first_names(self.names, self.kinds, kind="roth")) if _first_names(self.names, self.kinds, kind="roth") else 0.0,
                "brokerage": _sum_values(self.portfolio, [name for name in self.names if self.kinds[name] == "taxable"]) if any(self.kinds[name] == "taxable" for name in self.names) else 0.0,
                "bitcoin": _sum_values(self.portfolio, [name for name in self.names if self.kinds[name] == "bitcoin"]) if any(self.kinds[name] == "bitcoin" for name in self.names) else 0.0,
                "rental_properties": self._property_equity_total(rental_names) if rental_names else 0.0,
                "primary_home": self._property_equity_total(primary_names) if primary_names else 0.0,
                "cash_reserve": self.cash_reserve,
            }
            taxable_component_values = {
                "tax_w2": max(0.0, tracker["w2_income"] - employee_contribution),
                "tax_rental": max(0.0, tracker["rental_income"]),
                "tax_royalty": max(0.0, tracker["royalty_income"]),
                "tax_dividend": max(0.0, tracker["dividend_income"]),
                "tax_social_security": max(0.0, taxable_social_security),
                "tax_retirement": max(0.0, tracker["retirement_withdrawals"]),
                "tax_other": max(0.0, tracker["other_income"]),
            }
            taxable_component_total = sum(taxable_component_values.values())
            tax_component_amounts = {
                key: (final_income_tax * value / taxable_component_total if taxable_component_total else 0.0)
                for key, value in taxable_component_values.items()
            }
            rental_cash_flow_after_tax = rental_cash_flow_before_tax - tax_component_amounts["tax_rental"]
            # The main cash-flow chart nets rental OpEx and rental debt service
            # into the rental bar. Remove those same cash needs from its expense
            # line so the comparison never presents them twice. The canonical
            # total_expenses field remains unchanged for the accounting ledger.
            income_chart_expenses = max(
                0.0,
                target_expenses - rental_debt_service_total - rental_operating_shortfall,
            )
            mortgage_balance_total = sum(self.mortgage_balances.values())
            total_assets = _sum_values(self.portfolio, self.names) + self.cash_reserve - mortgage_balance_total
            liquid_assets = (_sum_values(self.portfolio, liquid_names) if liquid_names else 0.0) + self.cash_reserve
            property_names = [name for name in self.names if self.kinds[name] == "real_estate"]
            home_equity = self._property_equity_total(property_names) if property_names else 0.0
            row = {
                "year": year,
                "age": age,
                "nominal_net_worth": round(total_assets, 0),
                "total_assets": round(total_assets, 0),
                "liquid_net_worth": round(liquid_assets, 0),
                "property_net_worth": round(home_equity, 0),
                # Keep explicit aliases for clients that use asset rather
                # than net-worth terminology.
                "liquid_assets": round(liquid_assets, 0),
                "property_assets": round(home_equity, 0),
                "real_net_worth": round(total_assets / inflation_mult, 0),
                "total_expenses": round(target_expenses, 0),
                "tax_income_total": round(final_income_tax, 0),
                "tax_brokerage": round(sum(max(0.0, float(detail.get("haircut_amount", float(detail.get("gross", 0.0)) - float(detail.get("net", 0.0)) - float(detail.get("mortgage_payoff", 0.0))))) for detail in withdrawal_details if detail.get("category") in {"taxable", "rental", "primary"}), 0),
                "tax_bitcoin": round(sum(max(0.0, float(detail.get("gross", 0.0)) - float(detail.get("net", 0.0))) for detail in withdrawal_details if detail.get("category") == "bitcoin"), 0),
                "tax_total": round(tax_total, 0),
                "tax_w2": round(tax_component_amounts["tax_w2"], 0),
                "tax_rental": round(tax_component_amounts["tax_rental"], 0),
                "tax_royalty": round(tax_component_amounts["tax_royalty"], 0),
                "tax_dividend": round(tax_component_amounts["tax_dividend"], 0),
                "tax_social_security": round(tax_component_amounts["tax_social_security"], 0),
                "tax_retirement": round(tax_component_amounts["tax_retirement"], 0),
                "tax_other": round(tax_component_amounts["tax_other"], 0),
                "cash_income_before_tax": round(cash_income_before_tax, 0),
                "cash_income_after_tax": round(cash_income_after_tax, 0),
                "w2_income_after_tax": round(max(0.0, tracker["w2_income"] - employee_contribution - tax_component_amounts["tax_w2"]), 0),
                "rental_income_after_tax": round(max(0.0, tracker["rental_income"] - tax_component_amounts["tax_rental"]), 0),
                "rental_cash_flow_before_tax": round(rental_cash_flow_before_tax, 0),
                "rental_cash_flow_after_tax": round(rental_cash_flow_after_tax, 0),
                "rental_debt_service_total": round(rental_debt_service_total, 0),
                "income_chart_expenses": round(income_chart_expenses, 0),
                "royalty_income_after_tax": round(max(0.0, tracker["royalty_income"] - tax_component_amounts["tax_royalty"]), 0),
                "dividend_income_after_tax": round(max(0.0, tracker["dividend_income"] - tax_component_amounts["tax_dividend"]), 0),
                "social_security_after_tax": round(max(0.0, tracker["social_security"] - tax_component_amounts["tax_social_security"]), 0),
                "retirement_withdrawals_after_tax": round(max(0.0, tracker["retirement_withdrawals"] - tax_component_amounts["tax_retirement"]), 0),
                "brokerage_withdrawals_after_tax": sum(float(detail.get("net", 0.0)) for detail in withdrawal_details if detail.get("category") in {"taxable", "rental", "primary"}),
                "bitcoin_withdrawals_after_tax": sum(float(detail.get("net", 0.0)) for detail in withdrawal_details if detail.get("category") == "bitcoin"),
                "roth_withdrawals_after_tax": tracker["roth_withdrawals"],
                **asset_breakdown,
                "opening_portfolio": opening,
                "ending_portfolio": ending,
                "opening_mortgage_balances": opening_mortgage_balances,
                "ending_mortgage_balances": dict(self.mortgage_balances),
                "mortgage_balance_total": round(mortgage_balance_total, 0),
                "mortgage_payment_total": round(mortgage_payment_total, 0),
                "mortgage_interest_total": round(sum(float(item["interest_paid"]) for item in mortgage_details), 0),
                "mortgage_principal_total": round(sum(float(item["principal_paid"]) for item in mortgage_details), 0),
                "mortgage_details": mortgage_details,
                "property_gross_revenue": round(property_cash_totals["gross_revenue"], 0),
                "property_operating_expenses": round(property_cash_totals["operating_expenses"], 0),
                "property_net_operating_income": round(property_cash_totals["net_operating_income"], 0),
                "property_operating_shortfall": round(property_operating_shortfall, 0),
                "property_cash_flow_details": property_cash_details,
                "stock_return": stock_returns[-1],
                "investment_returns": growth_changes,
                "income": tracker,
                "income_details": income_details,
                "income_by_id": income_by_id,
                "employee_401k_contribution": employee_contribution,
                "employer_401k_match": employer_match,
                "contribution_destination": contribution_destination,
                "dividend_yield": self.dividend_yield,
                "dividend_reinvestment": dividend_reinvestment,
                "taxable_dividends_by_account": dividend_by_account,
                "social_security_taxable_fraction": ss_fraction,
                "social_security_taxable_amount": tracker["social_security"] * ss_fraction,
                "tax_component_method": "federal_tax_allocated_pro_rata_to_taxable_income_components",
                "rmd": rmd_metadata,
                "withdrawal_order": list(self.withdrawal_order),
                "withdrawals": withdrawal_details,
                "requested_withdrawal": requested_withdrawal,
                "funded_withdrawal": funded_withdrawal,
                "withdrawal_shortfall": withdrawal_shortfall,
                "surplus_destination": surplus_destination,
                "outflow_by_id": outflow_by_id,
                "outflows": outflow_details,
                "one_time_assets": one_time_asset_details,
                "one_time_expenses": one_time_expense_details,
                "blocks": [block for block in self.blocks if block.get("age") == age],
                "freedom_candidate": freedom_year == year,
            }
            # Preserve the old chart-facing fields exactly.
            row["nominal_net_worth"] = round(total_assets, 0)
            row["real_net_worth"] = round(total_assets / inflation_mult, 0)
            timeline.append(row)
            nominal_net_worth.append(float(round(total_assets, 0)))
            expenses_series.append(float(round(target_expenses, 0)))
            prior_dec31_pretax_names = _first_names(self.names, self.kinds, kind="pre_tax")
            prior_dec31_pretax = _sum_values(self.portfolio, prior_dec31_pretax_names) if prior_dec31_pretax_names else 0.0
            prior_dec31_by_account = {name: self.portfolio[name] for name in prior_dec31_pretax_names}

            if spending_reduction_years > 0:
                spending_reduction_years -= 1
                if spending_reduction_years == 0:
                    spending_reduction_pct = 0.0

        metadata = {
            "accounting_core": "holmes_accounting_v2",
            "simulation": {
                "mode": self.mode,
                "seed": self.seed,
                "run_index": self.run_index,
                "run_seed": _seed_for_run(self.seed, self.run_index),
            },
            "plan_through_age": self.plan_through_age,
            "age_semantics": "inclusive_age_first",
            "tax": {
                "filing_status": self.tax_status,
                "version": self.tax_version,
                "social_security_treatment": "standard_provisional_income"
                if getattr(self.params, "social_security_taxable_fraction", None) is None
                else "explicit_fraction_override",
                "social_security_taxable_fraction": getattr(self.params, "social_security_taxable_fraction", None),
            },
            "dividend": {"yield": self.dividend_yield, "taxable_yield": True, "tax_advantaged_reinvestment": True},
            "sale": {"haircut": self.sale_haircut, "property_haircut": self.property_sale_haircut, "property_policy": "all_or_nothing"},
            "housing": {
                "value_basis": "whole_property_value_times_ownership_percentage",
                "growth_basis": "global_inflation",
                "operating_cash_flow_basis": "whole_property_inputs_times_ownership_percentage_and_global_inflation",
                "mortgage_balance_basis": "debt_attributable_to_owned_share",
                "mortgage_payment_treatment": "essential_principal_and_interest_expense",
                "mortgage_payments_per_modeled_year": 12,
            },
            "rental_income_policy": "property_cash_flow_stops_when_that_property_is_sold; legacy rental streams stop after first rental sale",
            "cash_policy": "unallocated_cash_is_retained_in_explicit_cash_reserve",
            "rmd": {"start_age": self.rmd_start_age, "timing": "prior_december_31_balance", "divisor_table": "uniform_lifetime_simplified"},
            "withdrawal_order": list(self.withdrawal_order),
            "return_source": self.return_sequence.metadata if self.return_sequence is not None else {"mode": "custom", "source": "asset_growth_rates", "seed": self.seed, "wrap_continuation": "not_applicable"},
            "asset_ids": self.asset_ids,
            "stream_ids": {_stable_id("inflow", item, i): item.name for i, item in enumerate(getattr(self.params, "inflows", []) or [])},
            "one_time_asset_ids": {_stable_id("other_asset", item, i): item.name for i, item in enumerate(getattr(self.params, "other_assets", []) or [])},
            "one_time_expense_ids": {_stable_id("one_time_expense", item, i): item.name for i, item in enumerate(getattr(self.params, "one_time_expenses", []) or [])},
        }
        warnings: list[dict[str, str]] = []
        if metadata["return_source"].get("wrapped"):
            warnings.append(
                {
                    "code": "HISTORICAL_WRAP_CONTINUATION",
                    "severity": "medium",
                    "path": "historical_wrap_mode",
                    "message": "The historical source ended before the horizon; the documented circular continuation was used.",
                }
            )
        rental_asset_count = sum(
            1
            for name in self.names
            if self.kinds[name] == "real_estate" and not _is_primary(name, self._asset(name))
        )
        has_rental_income = any(
            getattr(stream, "income_type", None) == "rental"
            or (getattr(stream, "income_type", None) is None and "rental" in str(stream.name).lower())
            for stream in (getattr(self.params, "inflows", []) or [])
        )
        if rental_asset_count > 1 and has_rental_income:
            warnings.append(
                {
                    "code": "POOLED_RENTAL_INCOME",
                    "severity": "info",
                    "path": "inflows",
                    "message": "Rental income is modeled as one pooled stream and stops after the first rental property sale.",
                }
            )
        metadata["warnings"] = warnings
        return RunResult(
            timeline=timeline,
            freedom_year=freedom_year,
            # Success is defined against the configured final age, not the
            # legacy age-95 reporting cutoff.
            is_success=not ever_unfunded_before_plan_end,
            first_failure_year=first_failure_year,
            stock_returns=stock_returns,
            nominal_net_worth=nominal_net_worth,
            expenses=expenses_series,
            metadata=metadata,
            blocks=list(self.blocks),
        )


def simulate_one(params: Any, *, mode: str = "custom") -> dict[str, Any]:
    """Run one deterministic/custom or historical timeline."""

    effective_seed = DEFAULT_SEED if getattr(params, "seed", None) is None else int(getattr(params, "seed"))
    result = AccountingCore(params, mode=mode, seed=effective_seed).run()
    return {
        "timeline": result.timeline,
        "freedom_year": result.freedom_year,
        "metrics": {
            "nw_at_retirement": next((row for row in result.timeline if row["age"] == int(params.target_retirement_age)), None),
            "nw_at_90": next((row for row in result.timeline if row["age"] == 90), None),
            "nw_at_95": next((row for row in result.timeline if row["age"] == 95), None),
            "nw_at_plan_end": result.timeline[-1] if result.timeline else None,
        },
        "seed": effective_seed,
        "isSuccess": result.is_success,
        "firstFailureYear": result.first_failure_year,
        "metadata": result.metadata,
        "warnings": result.metadata.get("warnings", []),
        "blocks": result.blocks,
    }


def _without_spending_rules(params: Any) -> Any:
    """Return a validated plan copy with adaptive spending disabled."""

    if hasattr(params, "model_copy"):
        return params.model_copy(update={"spending_rules": []})
    # The public helper is also used by a few lightweight notebooks with a
    # SimpleNamespace-like object rather than a Pydantic request model.
    import copy

    baseline = copy.copy(params)
    baseline.spending_rules = []
    return baseline


def monte_carlo(
    params: Any,
    *,
    num_runs: int,
    stock_volatility: float,
    real_estate_volatility: float,
    inflation_volatility: float,
    seed: int | None,
    mode: str = "historical",
    include_baseline: bool = True,
) -> dict[str, Any]:
    """Aggregate many runs using the exact same accounting core."""

    if int(num_runs) < 1 or int(num_runs) > MAX_MONTE_CARLO_RUNS:
        raise ValueError(f"num_runs must be between 1 and {MAX_MONTE_CARLO_RUNS}")
    run_count = int(num_runs)
    effective_seed = DEFAULT_SEED if seed is None else int(seed)
    ages: list[int] = []
    years: list[int] = []
    nw_values: list[list[float]] = []
    liquid_values: list[list[float]] = []
    property_values: list[list[float]] = []
    stock_values: list[list[float]] = []
    expense_values: list[list[float]] = []
    outcomes: list[bool] = []
    first_metadata: dict[str, Any] = {}
    warning_map: dict[tuple[str, str], dict[str, str]] = {}
    block_map: dict[tuple[str, str, str, int | None], dict[str, Any]] = {}
    successes = 0
    for run_index in range(run_count):
        run = AccountingCore(params, mode=mode, seed=effective_seed, run_index=run_index).run(
            stock_volatility=stock_volatility,
            real_estate_volatility=real_estate_volatility,
            inflation_volatility=inflation_volatility,
        )
        if run_index == 0:
            ages = [int(row["age"]) for row in run.timeline]
            years = [int(row["year"]) for row in run.timeline]
            nw_values = [[] for _ in ages]
            liquid_values = [[] for _ in ages]
            property_values = [[] for _ in ages]
            stock_values = [[] for _ in ages]
            expense_values = [[] for _ in ages]
            first_metadata = run.metadata
        for index, row in enumerate(run.timeline):
            nw_values[index].append(float(row["nominal_net_worth"]))
            liquid_values[index].append(float(row.get("liquid_net_worth", row.get("liquid_assets", 0.0))))
            property_values[index].append(float(row.get("property_net_worth", row.get("property_assets", 0.0))))
            stock_values[index].append(float(row.get("stock_return", 0.0)))
            expense_values[index].append(float(row["total_expenses"]))
        outcomes.append(run.is_success)
        successes += int(run.is_success)
        for warning in run.metadata.get("warnings", []):
            warning_map[(str(warning.get("code")), str(warning.get("path")))] = warning
        for block in run.blocks:
            key = (
                str(block.get("code")),
                str(block.get("path")),
                str(block.get("message")),
                int(block["age"]) if block.get("age") is not None else None,
            )
            if key not in block_map:
                block_map[key] = {**block, "occurrences": 0, "first_run_index": run_index}
            block_map[key]["occurrences"] += 1

    percentile_data: list[dict[str, Any]] = []
    stock_box_data: list[dict[str, Any]] = []
    expense_data: list[dict[str, Any]] = []
    for index, age in enumerate(ages):
        vals = sorted(nw_values[index])
        liquid_vals = sorted(liquid_values[index])
        property_vals = sorted(property_values[index])
        percentile_data.append({
            "age": age,
            "year": years[index],
            "p10": _percentile(vals, 0.10),
            "p25": _percentile(vals, 0.25),
            "p50": _percentile(vals, 0.50),
            "p75": _percentile(vals, 0.75),
            "p90": _percentile(vals, 0.90),
            "mean": sum(vals) / len(vals) if vals else 0.0,
            # The aggregate timeline is a median snapshot. Keep liquid and
            # property wealth available to the table without pretending the
            # percentile chart is modeling two independent distributions.
            "liquid_net_worth": _percentile(liquid_vals, 0.50),
            "property_net_worth": _percentile(property_vals, 0.50),
        })
        stock_vals = sorted(stock_values[index])
        stock_box_data.append({"age": age, "year": years[index], "min": stock_vals[0], "q1": _percentile(stock_vals, 0.25), "median": _percentile(stock_vals, 0.50), "q3": _percentile(stock_vals, 0.75), "max": stock_vals[-1], "p10": _percentile(stock_vals, 0.10), "p90": _percentile(stock_vals, 0.90)})
        expense_vals = sorted(expense_values[index])
        expense_data.append({"age": age, "year": years[index], "p10": _percentile(expense_vals, 0.10), "p25": _percentile(expense_vals, 0.25), "p50": _percentile(expense_vals, 0.50), "p75": _percentile(expense_vals, 0.75), "p90": _percentile(expense_vals, 0.90), "mean": sum(expense_vals) / len(expense_vals) if expense_vals else 0.0})
    adaptive_enabled = bool(getattr(params, "spending_rules", None))
    adaptive_rate = successes / run_count * 100.0
    baseline_rate = adaptive_rate
    if include_baseline and adaptive_enabled:
        # The same seed/return source is replayed with the rules removed, so
        # the two success rates differ only because discretionary spending
        # changed.  A baseline is never substituted for the requested result.
        baseline_result = monte_carlo(
            _without_spending_rules(params),
            num_runs=num_runs,
            stock_volatility=stock_volatility,
            real_estate_volatility=real_estate_volatility,
            inflation_volatility=inflation_volatility,
            seed=seed,
            mode=mode,
            include_baseline=False,
        )
        baseline_rate = float(baseline_result["successRate"])
    return {
        "percentileData": percentile_data,
        "stockReturnBoxData": stock_box_data,
        "expensePercentileData": expense_data,
        # ``successRate`` remains the active plan's rate for compatibility;
        # both named rates are always exposed so the UI cannot conflate a
        # baseline and an adaptive result.
        "successRate": adaptive_rate,
        "baselineSuccessRate": baseline_rate,
        "adaptiveSuccessRate": adaptive_rate,
        "adaptiveSpendingEnabled": adaptive_enabled,
        "numRuns": run_count,
        "seed": effective_seed,
        "runOutcomes": outcomes,
        "metadata": first_metadata,
        "warnings": list(warning_map.values()),
        "blocks": list(block_map.values()),
    }


def monte_carlo_run(params: Any, *, run_index: int, num_runs: int, stock_volatility: float, real_estate_volatility: float, inflation_volatility: float, seed: int | None, mode: str = "historical") -> dict[str, Any]:
    if int(num_runs) < 1 or int(num_runs) > MAX_MONTE_CARLO_RUNS:
        raise ValueError(f"num_runs must be between 1 and {MAX_MONTE_CARLO_RUNS}")
    if int(run_index) < 0 or int(run_index) >= int(num_runs):
        raise ValueError("run_index must be between 0 and num_runs - 1")
    effective_seed = DEFAULT_SEED if seed is None else int(seed)
    run = AccountingCore(params, mode=mode, seed=effective_seed, run_index=int(run_index)).run(
        stock_volatility=stock_volatility,
        real_estate_volatility=real_estate_volatility,
        inflation_volatility=inflation_volatility,
    )
    stock_series = [
        {"age": row["age"], "year": row["year"], "stock_return": row.get("stock_return", 0.0)}
        for row in run.timeline
    ]
    return {
        "runIndex": int(run_index),
        "run_index": int(run_index),
        "numRuns": int(num_runs),
        "seed": effective_seed,
        "isSuccess": run.is_success,
        "is_success": run.is_success,
        "firstFailureYear": run.first_failure_year,
        "first_failure_year": run.first_failure_year,
        "timeline": run.timeline,
        "stockReturnSeries": stock_series,
        "metadata": run.metadata,
        "warnings": run.metadata.get("warnings", []),
        "blocks": run.blocks,
    }


# Compatibility helpers from the previous module.  Historical tests and
# external notebooks used these names directly; they now intentionally expose
# the exact contiguous data source rather than frequency buckets.
_HIST_STOCK_BINS_CACHE: list[tuple[float, float, float]] | None = None


def _get_historical_stock_return_bins(bin_size: float = 0.05) -> list[tuple[float, float, float]]:
    global _HIST_STOCK_BINS_CACHE
    if _HIST_STOCK_BINS_CACHE is None:
        values = _load_yearly_returns_csv(historical_returns_path())
        _HIST_STOCK_BINS_CACHE = [(value, value, 1.0 / len(values)) for value in values]
    return list(_HIST_STOCK_BINS_CACHE)


def _sample_historical_stock_return(rng: random.Random) -> float:
    values = _load_yearly_returns_csv(historical_returns_path())
    return values[rng.randrange(len(values))]


def _skewed_stock_shock(rng: random.Random, target_sigma: float) -> float:
    # Kept as a named compatibility helper.  It is no longer used as a silent
    # fallback; callers can opt into a custom sequence instead.
    sigma = _finite(target_sigma, field_name="stock_volatility")
    if sigma == 0:
        return 0.0
    return rng.gauss(0.0, sigma)


def _clamp_return(r: float) -> float:
    """Compatibility name that now refuses to clamp unsafe values."""

    value = _finite(r, field_name="return")
    if value <= -1.0:
        raise ValueError("return must be greater than -1")
    return value
