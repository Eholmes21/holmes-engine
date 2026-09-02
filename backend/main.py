"""FastAPI surface for the Holmes retirement projection engine.

The accounting rules are implemented once in :mod:`backend.core`.  This
module owns the wire models and keeps the historical field names used by the
React client while adding explicit controls for horizon, return source, tax,
RMD, sale and withdrawal behavior.
"""

from __future__ import annotations

from datetime import date
import math
import re
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

try:  # ``uvicorn main:app`` is launched from the backend directory.
    from .core import (
        AccountingBlocked,
        HistoricalDataError,
        MAX_MONTE_CARLO_RUNS,
        TAXABLE_SALE_NET_FACTOR,
        TAXABLE_SALE_TAX_RATE,
        _clamp_return,
        _get_historical_stock_return_bins,
        _load_yearly_returns_csv,
        _sample_historical_stock_return,
        _withdrawal_token,
        calculate_federal_tax,
        get_rmd_divisor,
        monte_carlo,
        monte_carlo_run,
        request_fingerprint,
        simulate_one,
    )
except ImportError:  # pragma: no cover - exercised by the standalone runner
    from core import (  # type: ignore
        AccountingBlocked,
        HistoricalDataError,
        MAX_MONTE_CARLO_RUNS,
        TAXABLE_SALE_NET_FACTOR,
        TAXABLE_SALE_TAX_RATE,
        _clamp_return,
        _get_historical_stock_return_bins,
        _load_yearly_returns_csv,
        _sample_historical_stock_return,
        _withdrawal_token,
        calculate_federal_tax,
        get_rmd_divisor,
        monte_carlo,
        monte_carlo_run,
        request_fingerprint,
        simulate_one,
    )


app = FastAPI(title="Holmes Retirement Engine", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Keep validation responses useful without echoing caller payloads."""

    details: list[dict[str, str]] = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ()) if part not in {"body", "query", "path"}]
        path = ".".join(location) or "request"
        code = "REQUIRED" if error.get("type") == "missing" else "VALIDATION_ERROR"
        raw_message = str(error.get("msg", ""))
        if "names must be unique" in raw_message:
            code, path, message = "DUPLICATE_NAME", path or "request", "display names must be unique (case/whitespace-insensitive)"
        elif "stable IDs must be unique" in raw_message or "IDs must be unique" in raw_message:
            code, path, message = "DUPLICATE_ID", path or "request", "stable IDs must be unique"
        elif "plan_through_age must be between" in raw_message:
            code, path, message = "HORIZON_RANGE", "plan_through_age", "plan-through age must be between 85 and 115"
        elif "target_retirement_age must be between" in raw_message:
            code, path, message = "AGE_ORDER", "target_retirement_age", "retirement age must be between current age and plan-through age"
        elif "return_mode was supplied more than once" in raw_message:
            code, path, message = "DUPLICATE_MODE", "mode", "mode was supplied more than once"
        else:
            message = "field is required" if code == "REQUIRED" else "field violates the retirement.v2 contract"
        details.append({"path": path, "code": code, "message": message})
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed", "details": details}},
    )


_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_ALLOWED_TAX_TREATMENTS = {
    "pre_tax", "pretax", "traditional", "traditional_ira", "tax_deferred", "401k",
    "roth", "roth_ira", "tax_free", "tax_advantaged_roth", "tax_advantaged", "bitcoin", "crypto",
    "tax_deferred_or_roth", "taxable", "real_estate", "property", "rental", "home",
}


def _finite(value: float, field_name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{field_name} must be a finite number") from None
    if not math.isfinite(result):
        raise ValueError(f"{field_name} must be finite")
    return result


def _nonnegative(value: float, field_name: str) -> float:
    result = _finite(value, field_name)
    if result < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return result


def _nonblank(value: str, field_name: str = "name") -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be nonblank")
    return value.strip()


def _optional_id(value: str | None) -> str | None:
    if value is None:
        return None
    value = _nonblank(value, "id")
    if not _ID_RE.fullmatch(value):
        raise ValueError("id must contain only letters, numbers, underscore or hyphen")
    return value


def _aliases(data: Any, mapping: dict[str, str]) -> Any:
    if not isinstance(data, dict):
        return data
    result = dict(data)
    for old, new in mapping.items():
        if old in result:
            if new in result and result[new] != result[old]:
                raise ValueError(f"{new} was supplied more than once")
            result[new] = result.pop(old)
    return result


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Asset(WireModel):
    id: str | None = None
    name: str
    value: float
    growth_rate: float
    tax_treatment: str = "taxable"
    dividend_yield: float | None = None
    property_role: str | None = None
    workplace_plan: bool = False
    # Property values are entered as whole-property market values.  The core
    # multiplies by this ownership fraction before adding the property to the
    # user's ledger. Mortgage balances are the debt attributable to that owned
    # share, and scheduled P&I payments become essential annual spending.
    ownership_percentage: float = 1.0
    mortgage_balance: float = 0.0
    mortgage_interest_rate: float = 0.0
    mortgage_monthly_payment: float = 0.0
    mortgage_payments_remaining: int = 0
    # Revenue and operating expenses are entered for the whole property. The
    # accounting core applies the ownership share and global inflation.
    annual_revenue: float = 0.0
    annual_operating_expenses: float = 0.0

    @model_validator(mode="before")
    @classmethod
    def accept_workplace_aliases(cls, data: Any) -> Any:
        return _aliases(data, {"workplace": "workplace_plan", "rmd_delay_until_retirement": "workplace_plan"})

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str | None) -> str | None:
        return _optional_id(value)

    @field_validator(
        "value",
        "mortgage_balance",
        "mortgage_monthly_payment",
        "annual_revenue",
        "annual_operating_expenses",
    )
    @classmethod
    def valid_value(cls, value: float) -> float:
        return _nonnegative(value, "value")

    @field_validator("ownership_percentage")
    @classmethod
    def valid_ownership_percentage(cls, value: float) -> float:
        value = _finite(value, "ownership_percentage")
        if not 0.0 <= value <= 1.0:
            raise ValueError("ownership_percentage must be between 0 and 1")
        return value

    @field_validator("mortgage_interest_rate")
    @classmethod
    def valid_mortgage_interest_rate(cls, value: float) -> float:
        value = _finite(value, "mortgage_interest_rate")
        if not 0.0 <= value <= 1.0:
            raise ValueError("mortgage_interest_rate must be between 0 and 1")
        return value

    @field_validator("mortgage_payments_remaining")
    @classmethod
    def valid_mortgage_payments_remaining(cls, value: int) -> int:
        if value < 0 or value > 1200:
            raise ValueError("mortgage_payments_remaining must be between 0 and 1200")
        return value

    @field_validator("growth_rate")
    @classmethod
    def valid_growth(cls, value: float) -> float:
        value = _finite(value, "growth_rate")
        if value <= -1.0:
            raise ValueError("growth_rate must be greater than -1")
        return value

    @field_validator("dividend_yield")
    @classmethod
    def valid_dividend_yield(cls, value: float | None) -> float | None:
        if value is None:
            return value
        value = _finite(value, "dividend_yield")
        if not 0.0 <= value <= 1.0:
            raise ValueError("dividend_yield must be between 0 and 1")
        return value

    @field_validator("tax_treatment")
    @classmethod
    def valid_tax_treatment(cls, value: str) -> str:
        value = _nonblank(value, "tax_treatment").lower()
        if value not in _ALLOWED_TAX_TREATMENTS:
            raise ValueError("tax_treatment is unsupported")
        return value


class Stream(WireModel):
    id: str | None = None
    name: str
    amount: float
    start_year: int
    end_year: int
    growth_rate: float | None = None
    # Explicit income classification keeps account behavior independent from
    # display labels.  ``None`` preserves compatibility with older plans and
    # falls back to the legacy name-based inference in the core.
    income_type: Literal["w2", "rental", "royalty", "social_security", "other"] | None = None
    # ``global`` lets Historical Monte Carlo inflation volatility flow through
    # this stream.  ``custom`` preserves the explicit per-stream rate.
    growth_mode: Literal["global", "custom"] = "custom"
    # Adaptive spending applies only to flexible/discretionary expenses by
    # default. Essential costs can opt out without needing a second planner.
    discretionary: bool = True

    @model_validator(mode="before")
    @classmethod
    def accept_discretionary_aliases(cls, data: Any) -> Any:
        result = _aliases(data, {
            "is_discretionary": "discretionary", "flexible": "discretionary",
            "incomeType": "income_type", "stream_type": "income_type", "category": "income_type",
        })
        if isinstance(result, dict) and result.get("income_type") is not None:
            value = str(result["income_type"]).strip().lower().replace("-", "_").replace(" ", "_")
            aliases = {
                "salary": "w2", "wages": "w2", "employment": "w2",
                "rental_profit": "rental", "rent": "rental",
                "royalties": "royalty", "ss": "social_security", "social": "social_security",
            }
            result["income_type"] = aliases.get(value, value)
        return result

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str | None) -> str | None:
        return _optional_id(value)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: float) -> float:
        return _nonnegative(value, "amount")

    @field_validator("growth_rate")
    @classmethod
    def valid_growth(cls, value: float | None) -> float | None:
        if value is None:
            return value
        value = _finite(value, "growth_rate")
        if value <= -1.0:
            raise ValueError("growth_rate must be greater than -1")
        return value

    @field_validator("income_type")
    @classmethod
    def valid_income_type(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = _nonblank(value, "income_type").lower().replace("-", "_").replace(" ", "_")
        if value not in {"w2", "rental", "royalty", "social_security", "other"}:
            raise ValueError("income_type is unsupported")
        return value

    @model_validator(mode="after")
    def valid_years(self) -> "Stream":
        if self.end_year < self.start_year:
            raise ValueError("end_year must be no earlier than start_year")
        return self


class OtherAsset(WireModel):
    id: str | None = None
    name: str
    value: float
    add_year: int
    destination_account: str | None = None

    @model_validator(mode="before")
    @classmethod
    def accept_destination_alias(cls, data: Any) -> Any:
        return _aliases(data, {"destination": "destination_account", "route": "destination_account"})

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str | None) -> str | None:
        return _optional_id(value)

    @field_validator("value")
    @classmethod
    def valid_value(cls, value: float) -> float:
        return _nonnegative(value, "value")


class OneTimeExpense(WireModel):
    id: str | None = None
    name: str
    amount: float
    year: int
    add_to_primary_home: bool = False
    destination_account: str | None = None

    @model_validator(mode="before")
    @classmethod
    def accept_destination_alias(cls, data: Any) -> Any:
        return _aliases(data, {"destination": "destination_account", "route": "destination_account"})

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str | None) -> str | None:
        return _optional_id(value)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: float) -> float:
        return _nonnegative(value, "amount")


class SpendingRule(WireModel):
    id: str | None = None
    stock_down_threshold: float = 0.0
    reduce_spending_pct: float = 0.0
    years: int = 0

    @model_validator(mode="before")
    @classmethod
    def accept_frontend_names(cls, data: Any) -> Any:
        return _aliases(data, {"stockDownPct": "stock_down_threshold", "reduceSpendingPct": "reduce_spending_pct"})

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str | None) -> str | None:
        return _optional_id(value)

    @field_validator("stock_down_threshold", "reduce_spending_pct")
    @classmethod
    def valid_fraction(cls, value: float) -> float:
        value = _finite(value, "spending_rule")
        if not 0.0 <= value <= 1.0:
            raise ValueError("spending rule fractions must be between 0 and 1")
        return value

    @field_validator("years")
    @classmethod
    def valid_years(cls, value: int) -> int:
        if value < 0 or value > 120:
            raise ValueError("spending rule years must be between 0 and 120")
        return value


class SimParams(WireModel):
    # A factory keeps defaults current without changing an explicitly supplied
    # historical year in an existing saved request.
    current_year: int = Field(default_factory=lambda: date.today().year)
    current_age: int = 38
    target_retirement_age: int
    retirement_withdrawal_age: int = 60
    plan_through_age: int = 100
    general_inflation: float
    tax_filing_status: str = "married_joint"
    tax_version: str = "2025_simplified"
    assets: list[Asset]
    inflows: list[Stream]
    outflows: list[Stream]
    other_assets: list[OtherAsset] = Field(default_factory=list)
    one_time_expenses: list[OneTimeExpense] = Field(default_factory=list)
    return_mode: Literal["custom", "historical"] | None = None
    historical_start_index: int | None = None
    historical_wrap_mode: Literal["continue", "error"] = "continue"
    # Boolean aliases are accepted for small clients; the normalized mode is
    # still emitted in metadata so continuation is visible.
    historical_wrap: bool | None = None
    wrap_continuation: bool | None = None
    custom_return_sequence: list[float] | None = None
    dividend_yield: float = 0.01
    sale_haircut: float = 0.10
    property_sale_haircut: float | None = None
    workplace_contribution_limit: float = 24500.0
    employer_match_rate: float = 0.13
    # Approved default: RMDs, taxable, bitcoin, pre-tax, Roth, rental,
    # primary.  RMDs are applied by the core before discretionary draws.
    withdrawal_order: list[str] = Field(default_factory=lambda: ["rmds", "taxable", "bitcoin", "pre_tax", "roth", "rental", "primary"])
    allow_property_sale: bool = True
    allow_primary_home_sale: bool = True
    rmd_start_age: Literal[73, 75] = 73
    # ``None`` selects the standard provisional-income treatment.  A numeric
    # value remains available for an explicitly simplified user override.
    social_security_taxable_fraction: float | None = None
    spending_rules: list[SpendingRule] = Field(default_factory=list)
    seed: int | None = 0
    request_token: str | None = None

    @model_validator(mode="before")
    @classmethod
    def accept_feature_aliases(cls, data: Any) -> Any:
        result = _aliases(data, {
            "end_age": "plan_through_age", "plan_end_age": "plan_through_age",
            "simulation_mode": "return_mode", "mode": "return_mode",
            "historical_start": "historical_start_index", "historical_return_start": "historical_start_index", "wrap_mode": "historical_wrap_mode",
            "sale_haircut_pct": "sale_haircut", "taxable_sale_haircut": "sale_haircut",
            "property_haircut": "property_sale_haircut", "dividend_yield_rate": "dividend_yield",
            "withdrawal_account_order": "withdrawal_order", "rmd_age": "rmd_start_age",
            "tax_status": "tax_filing_status", "tax_table_version": "tax_version",
            "ss_taxable_fraction": "social_security_taxable_fraction",
            "contribution_limit": "workplace_contribution_limit", "401k_contribution_limit": "workplace_contribution_limit",
            "match_rate": "employer_match_rate", "employer_match": "employer_match_rate",
            "returns": "custom_return_sequence", "return_sequence": "custom_return_sequence",
            "custom_returns": "custom_return_sequence",
        })
        if isinstance(result, dict):
            mode = result.get("return_mode")
            if mode in {"deterministic", "custom_deterministic", "configured", "fixed"}:
                result["return_mode"] = "custom"
            elif mode in {"historical_contiguous", "historical_sequence", "historical_csv"}:
                result["return_mode"] = "historical"
            if "historical_wrap" in result and "historical_wrap_mode" not in result:
                result["historical_wrap_mode"] = "continue" if result["historical_wrap"] else "error"
            if "wrap_continuation" in result and "historical_wrap_mode" not in result:
                result["historical_wrap_mode"] = "continue" if result["wrap_continuation"] else "error"
        return result

    @field_validator("general_inflation")
    @classmethod
    def valid_inflation(cls, value: float) -> float:
        value = _finite(value, "general_inflation")
        if value <= -1.0:
            raise ValueError("general_inflation must be greater than -1")
        return value

    @field_validator("dividend_yield", "sale_haircut")
    @classmethod
    def valid_fraction(cls, value: float) -> float:
        value = _finite(value, "fraction")
        if not 0.0 <= value < 1.0:
            raise ValueError("fraction must be between 0 and 1")
        return value

    @field_validator("employer_match_rate")
    @classmethod
    def valid_match_cap(cls, value: float) -> float:
        value = _finite(value, "employer_match_rate")
        if not 0.0 <= value <= 1.0:
            raise ValueError("employer_match_rate must be between 0 and 1")
        return value

    @field_validator("workplace_contribution_limit")
    @classmethod
    def valid_contribution_limit(cls, value: float) -> float:
        return _nonnegative(value, "workplace_contribution_limit")

    @field_validator("social_security_taxable_fraction")
    @classmethod
    def valid_ss_fraction(cls, value: float | None) -> float | None:
        if value is None:
            return None
        value = _finite(value, "social_security_taxable_fraction")
        if not 0.0 <= value <= 1.0:
            raise ValueError("social_security_taxable_fraction must be between 0 and 1")
        return value

    @field_validator("property_sale_haircut")
    @classmethod
    def valid_property_haircut(cls, value: float | None) -> float | None:
        if value is None:
            return value
        value = _finite(value, "property_sale_haircut")
        if not 0.0 <= value < 1.0:
            raise ValueError("property_sale_haircut must be between 0 and 1")
        return value

    @field_validator("custom_return_sequence")
    @classmethod
    def valid_custom_sequence(cls, value: list[float] | None) -> list[float] | None:
        if value is None:
            return value
        if not value:
            raise ValueError("custom_return_sequence must not be empty")
        normalized = [_finite(item, "custom_return_sequence") for item in value]
        if any(item <= -1.0 for item in normalized):
            raise ValueError("custom_return_sequence values must be greater than -1")
        return normalized

    @field_validator("historical_start_index")
    @classmethod
    def valid_start_index(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("historical_start_index must be non-negative")
        return value

    @field_validator("request_token")
    @classmethod
    def valid_request_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        token = _nonblank(value, "request_token")
        if len(token) > 128:
            raise ValueError("request_token is too long")
        return token

    @model_validator(mode="after")
    def validate_cross_fields(self) -> "SimParams":
        if self.current_year < 1900 or self.current_year > 2200:
            raise ValueError("current_year is outside the supported range")
        if not 85 <= self.plan_through_age <= 115:
            raise ValueError("plan_through_age must be between 85 and 115")
        if self.current_age < 0 or self.current_age > 120:
            raise ValueError("current_age is outside the supported range")
        if self.target_retirement_age < self.current_age or self.target_retirement_age > self.plan_through_age:
            raise ValueError("target_retirement_age must be between current_age and plan_through_age")
        if self.retirement_withdrawal_age < 0 or self.retirement_withdrawal_age > self.plan_through_age:
            raise ValueError("retirement_withdrawal_age must be between 0 and plan_through_age")
        if not self.assets:
            raise ValueError("assets must contain at least one item")
        last_year = self.current_year + (self.plan_through_age - self.current_age)
        for path, streams in (("inflows", self.inflows), ("outflows", self.outflows)):
            for stream in streams:
                if stream.end_year < self.current_year or stream.start_year > last_year:
                    raise ValueError(f"{path} must overlap the modeled horizon")
        for item in self.other_assets:
            if item.add_year < self.current_year or item.add_year > last_year:
                raise ValueError("other_assets add_year must fall inside the modeled horizon")
        for item in self.one_time_expenses:
            if item.year < self.current_year or item.year > last_year:
                raise ValueError("one_time_expenses year must fall inside the modeled horizon")
        collections = (("assets", self.assets), ("inflows", self.inflows), ("outflows", self.outflows), ("other_assets", self.other_assets), ("one_time_expenses", self.one_time_expenses), ("spending_rules", self.spending_rules))
        for path, items in collections:
            _validate_stable_ids(items, path)
        all_explicit_ids: set[str] = set()
        for _, items in collections:
            for item in items:
                item_id = getattr(item, "id", None)
                if item_id:
                    key = str(item_id).casefold()
                    if key in all_explicit_ids:
                        raise ValueError("stable IDs must be unique across the request")
                    all_explicit_ids.add(key)
        status = self.tax_filing_status.strip().lower().replace("-", "_").replace(" ", "_")
        if status in {"mfj", "married", "married_filing_jointly", "joint"}:
            status = "married_joint"
        if status not in {"married_joint", "single"}:
            raise ValueError("tax_filing_status must be married_joint or single")
        object.__setattr__(self, "tax_filing_status", status)
        version = self.tax_version.strip().lower().replace("-", "_")
        if version in {"2025", "2025_simple", "2025_federal"}:
            version = "2025_simplified"
        if version != "2025_simplified":
            raise ValueError("tax_version is unsupported")
        object.__setattr__(self, "tax_version", version)
        normalized_order = [_withdrawal_token(item) for item in self.withdrawal_order]
        supported_order = {"rmds", "pre_tax", "taxable", "bitcoin", "roth", "rental", "primary"}
        if not normalized_order or len(set(normalized_order)) != len(normalized_order):
            raise ValueError("withdrawal_order must contain unique categories")
        if set(normalized_order) != supported_order:
            raise ValueError("withdrawal_order must include every supported account category exactly once")
        object.__setattr__(self, "withdrawal_order", normalized_order)
        if self.custom_return_sequence is not None and self.return_mode == "historical":
            raise ValueError("custom_return_sequence cannot be used with historical return_mode")
        return self


def _validate_stable_ids(items: list[Any], path: str) -> None:
    # Names are part of the old wire format and become dictionary keys in the
    # ledger.  Case/whitespace-insensitive duplicate detection prevents a
    # visually indistinguishable item from overwriting another one.
    names: set[str] = set()
    ids: set[str] = set()
    for item in items:
        name = getattr(item, "name", None)
        if name is not None:
            key = " ".join(str(name).split()).casefold()
            if key in names:
                raise ValueError(f"{path} names must be unique")
            names.add(key)
        item_id = getattr(item, "id", None)
        if item_id:
            key = str(item_id).casefold()
            if key in ids:
                raise ValueError(f"{path} IDs must be unique")
            ids.add(key)


class MonteCarloRequest(WireModel):
    params: SimParams
    num_runs: int = Field(default=200, ge=1, le=MAX_MONTE_CARLO_RUNS)
    stock_volatility: float = Field(default=0.15, ge=0.0, le=1.0)
    real_estate_volatility: float = Field(default=0.08, ge=0.0, le=1.0)
    inflation_volatility: float = Field(default=0.0, ge=0.0, le=1.0)
    seed: int | None = None
    return_mode: Literal["custom", "historical"] | None = None
    spending_rule: SpendingRule | None = None
    spending_rules: list[SpendingRule] | None = None
    # An inspector may present the aggregate response fingerprint.  It is
    # checked before calculating so it cannot silently inspect another plan.
    fingerprint: str | None = None
    request_token: str | None = None

    @model_validator(mode="before")
    @classmethod
    def accept_fingerprint_aliases(cls, data: Any) -> Any:
        result = _aliases(data, {
            "requestToken": "request_token", "request_fingerprint": "fingerprint",
            "mode": "return_mode", "simulation_mode": "return_mode", "return_source": "return_mode",
        })
        if isinstance(result, dict):
            mode = result.get("return_mode")
            if mode in {"deterministic", "custom_deterministic", "configured", "fixed"}:
                result["return_mode"] = "custom"
            elif mode in {"historical_contiguous", "historical_sequence", "historical_csv"}:
                result["return_mode"] = "historical"
        return result

    @model_validator(mode="after")
    def validate_rules(self) -> "MonteCarloRequest":
        _validate_stable_ids(self.spending_rules or [], "spending_rules")
        if self.spending_rule and self.spending_rules:
            _validate_stable_ids([self.spending_rule, *self.spending_rules], "spending_rules")
        if self.fingerprint is not None and not re.fullmatch(r"[0-9a-fA-F]{32,128}", self.fingerprint):
            raise ValueError("fingerprint has invalid syntax")
        if self.request_token is not None:
            token = _nonblank(self.request_token, "request_token")
            if len(token) > 128:
                raise ValueError("request_token is too long")
            # Assignment validation is enabled on the wire models.  Use the
            # low-level setter inside this after-validator so normalizing a
            # token does not recursively invoke the validator itself.
            object.__setattr__(self, "request_token", token)
        return self


class MonteCarloRunRequest(MonteCarloRequest):
    run_index: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_run_index(self) -> "MonteCarloRunRequest":
        if self.run_index >= self.num_runs:
            raise ValueError("run_index must be between 0 and num_runs - 1")
        return self


def _merged_params(params: SimParams, single: SpendingRule | None, multiple: list[SpendingRule] | None) -> SimParams:
    rules = list(params.spending_rules)
    if multiple:
        rules.extend(multiple)
    if single:
        rules.append(single)
    if rules:
        _validate_stable_ids(rules, "spending_rules")
    return params.model_copy(update={"spending_rules": rules})


def _collect_spending_rules(single: SpendingRule | None, multiple: list[SpendingRule] | None) -> list[SpendingRule]:
    """Compatibility helper retained for callers of the former module."""

    rules = list(multiple or [])
    if single is not None:
        rules.append(single)
    return rules


def _error_response(exc: Exception) -> JSONResponse:
    if isinstance(exc, HistoricalDataError):
        status, code, message, path = 503, exc.code, exc.message, exc.path
    elif isinstance(exc, AccountingBlocked):
        status, code, message, path = 422, exc.code, exc.message, exc.path
    else:
        status, code, message, path = 422, "VALIDATION_ERROR", str(exc) or "Request could not be calculated", "request"
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": [{"path": path, "code": code, "message": message}]}})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "holmes-engine", "version": "2.0"}


@app.post("/simulate")
def run_simulation(params: SimParams):
    try:
        mode = params.return_mode or "custom"
        result = simulate_one(params, mode=mode)
        token = request_fingerprint(
            params,
            mode=mode,
            num_runs=1,
            stock_volatility=0.0,
            real_estate_volatility=0.0,
            inflation_volatility=0.0,
            seed=params.seed,
        )
        result["fingerprint"] = token
        result["resultToken"] = token
        result["requestToken"] = params.request_token or token
        result["request_token"] = params.request_token or token
        result["request_fingerprint"] = token
        return result
    except (AccountingBlocked, HistoricalDataError, ValueError) as exc:
        return _error_response(exc)


@app.post("/monte_carlo")
def run_monte_carlo(req: MonteCarloRequest):
    try:
        params = _merged_params(req.params, req.spending_rule, req.spending_rules)
        mode = req.return_mode or params.return_mode or ("custom" if params.custom_return_sequence else "historical")
        effective_seed = req.seed if req.seed is not None else params.seed
        result = monte_carlo(params, num_runs=req.num_runs, stock_volatility=req.stock_volatility, real_estate_volatility=req.real_estate_volatility, inflation_volatility=req.inflation_volatility, seed=effective_seed, mode=mode)
        result["fingerprint"] = request_fingerprint(params, mode=mode, num_runs=req.num_runs, stock_volatility=req.stock_volatility, real_estate_volatility=req.real_estate_volatility, inflation_volatility=req.inflation_volatility, seed=effective_seed)
        result["resultToken"] = result["fingerprint"]
        result["requestToken"] = req.request_token or result["fingerprint"]
        result["request_token"] = req.request_token or result["fingerprint"]
        result["request_fingerprint"] = result["fingerprint"]
        return result
    except (AccountingBlocked, HistoricalDataError, ValueError) as exc:
        return _error_response(exc)


@app.post("/monte_carlo_run")
def run_monte_carlo_inspector(req: MonteCarloRunRequest):
    try:
        params = _merged_params(req.params, req.spending_rule, req.spending_rules)
        mode = req.return_mode or params.return_mode or ("custom" if params.custom_return_sequence else "historical")
        effective_seed = req.seed if req.seed is not None else params.seed
        expected = request_fingerprint(params, mode=mode, num_runs=req.num_runs, stock_volatility=req.stock_volatility, real_estate_volatility=req.real_estate_volatility, inflation_volatility=req.inflation_volatility, seed=effective_seed)
        if req.fingerprint is not None and req.fingerprint != expected:
            return _error_response(AccountingBlocked("FINGERPRINT_MISMATCH", "The inspector request does not match the aggregate Monte Carlo plan", path="fingerprint"))
        result = monte_carlo_run(params, run_index=req.run_index, num_runs=req.num_runs, stock_volatility=req.stock_volatility, real_estate_volatility=req.real_estate_volatility, inflation_volatility=req.inflation_volatility, seed=effective_seed, mode=mode)
        result["fingerprint"] = expected
        result["resultToken"] = expected
        result["requestToken"] = req.request_token or expected
        result["request_token"] = req.request_token or expected
        result["request_fingerprint"] = expected
        return result
    except (AccountingBlocked, HistoricalDataError, ValueError) as exc:
        return _error_response(exc)


__all__ = [
    "app", "Asset", "Stream", "OtherAsset", "OneTimeExpense", "SimParams",
    "SpendingRule", "MonteCarloRequest", "MonteCarloRunRequest",
    "calculate_federal_tax", "get_rmd_divisor", "TAXABLE_SALE_TAX_RATE",
    "TAXABLE_SALE_NET_FACTOR", "_load_yearly_returns_csv", "_get_historical_stock_return_bins",
    "_sample_historical_stock_return", "_clamp_return", "_collect_spending_rules", "request_fingerprint",
]
