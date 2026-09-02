from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

try:
    from backend.core import HistoricalDataError, calculate_federal_tax, get_rmd_divisor, request_fingerprint, simulate_one
    from backend.main import SimParams, app
except ModuleNotFoundError:  # Running discovery from the backend directory.
    from core import HistoricalDataError, calculate_federal_tax, get_rmd_divisor, request_fingerprint, simulate_one
    from main import SimParams, app


def params(**overrides):
    payload = {
        "current_year": 2026,
        "current_age": 38,
        "target_retirement_age": 60,
        "retirement_withdrawal_age": 60,
        "plan_through_age": 85,
        "general_inflation": 0.0,
        "assets": [
            {"name": "401k", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "pre_tax"},
            {"name": "Roth IRA", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "roth"},
            {"name": "Brokerage", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "taxable"},
        ],
        "inflows": [],
        "outflows": [],
        "dividend_yield": 0.0,
        "mode": "custom",
        "seed": 0,
    }
    payload.update(overrides)
    if "return_mode" in overrides:
        payload.pop("mode", None)
    return SimParams.model_validate(payload)


class CoreRulesTests(unittest.TestCase):
    def test_custom_timeline_is_inclusive_and_replayable(self):
        request = params(custom_return_sequence=[0.1])
        first = simulate_one(request, mode="custom")
        second = simulate_one(request, mode="custom")
        self.assertEqual([row["age"] for row in first["timeline"]], list(range(38, 86)))
        self.assertEqual(first["timeline"], second["timeline"])
        self.assertEqual(first["metadata"]["return_source"]["source"], "custom_sequence")
        self.assertEqual(first["seed"], 0)

    def test_historical_sequence_wrap_is_explicit(self):
        request = params(
            current_age=38,
            target_retirement_age=60,
            plan_through_age=115,
            return_mode="historical",
            historical_start_index=85,
            historical_wrap_mode="continue",
        )
        result = simulate_one(request, mode="historical")
        source = result["metadata"]["return_source"]
        self.assertEqual(source["indices"][0], 85)
        self.assertEqual(source["indices"][1], 0)
        self.assertTrue(source["wrapped"])
        self.assertEqual(source["wrap_continuation"], "continue")
        self.assertEqual(source["source_first_year"], 1940)
        self.assertEqual(source["source_last_year"], 2025)
        self.assertEqual(len(source["source_years"]), source["sequence_length"])
        self.assertRegex(source["source_hash"], r"^[0-9a-f]{64}$")

    def test_historical_sequence_can_block_without_wrap(self):
        request = params(
            return_mode="historical",
            historical_start_index=85,
            historical_wrap_mode="error",
        )
        with self.assertRaises(HistoricalDataError):
            simulate_one(request, mode="historical")

    def test_rmd_uses_prior_december_balance_and_excludes_roth(self):
        request = params(
            current_age=72,
            target_retirement_age=72,
            retirement_withdrawal_age=72,
            plan_through_age=85,
            rmd_start_age=73,
        )
        result = simulate_one(request, mode="custom")
        row_72 = next(row for row in result["timeline"] if row["age"] == 72)
        row_73 = next(row for row in result["timeline"] if row["age"] == 73)
        self.assertEqual(row_72["rmd"]["required_amount"], 0.0)
        self.assertAlmostEqual(row_73["rmd"]["prior_december_31_balance"], 1_000_000.0)
        self.assertAlmostEqual(row_73["rmd"]["required_amount"], 1_000_000.0 / 26.5)
        self.assertAlmostEqual(row_73["rmd"]["used_amount"], row_73["rmd"]["required_amount"])
        self.assertAlmostEqual(row_73["ending_portfolio"]["Roth IRA"], 100_000.0)

    def test_rmd_reporting_excludes_discretionary_pre_tax_withdrawals(self):
        request = params(
            current_age=73,
            target_retirement_age=73,
            retirement_withdrawal_age=73,
            plan_through_age=85,
            assets=[{"name": "401k", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "pre_tax"}],
            outflows=[{"name": "Living", "amount": 100_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertAlmostEqual(row["rmd"]["used_amount"], row["rmd"]["required_amount"], places=5)
        self.assertGreater(row["income"]["retirement_withdrawals"], row["rmd"]["used_amount"])
        self.assertGreater(row["rmd"]["excess_amount"], 0.0)

    def test_rmd_table_supports_plan_through_age_115(self):
        self.assertAlmostEqual(get_rmd_divisor(115), 2.9)

    def test_pre_tax_withdrawal_is_iteratively_grossed_up(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "401k", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "pre_tax"}],
            outflows=[{"name": "Living", "amount": 100_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        withdrawal = row["withdrawals"][0]
        self.assertGreater(withdrawal["gross"], withdrawal["net"])
        self.assertAlmostEqual(withdrawal["net"], 100_000.0, places=5)
        self.assertGreater(row["tax_income_total"], 0.0)
        self.assertAlmostEqual(row["cash_income_after_tax"], 100_000.0, delta=1.0)

    def test_pre_tax_withdrawal_recalculates_social_security_taxability(self):
        request = params(
            current_age=70,
            target_retirement_age=70,
            retirement_withdrawal_age=70,
            plan_through_age=85,
            assets=[{"name": "401k", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "pre_tax"}],
            inflows=[{"name": "Social Security", "income_type": "social_security", "amount": 40_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
            outflows=[{"name": "Living", "amount": 100_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertGreater(row["social_security_taxable_amount"], 0.0)
        self.assertGreater(row["withdrawals"][0]["gross"], 60_000.0)
        self.assertAlmostEqual(row["cash_income_after_tax"], 100_000.0, delta=1.0)

    def test_2025_simplified_tax_table_uses_final_irs_thresholds(self):
        self.assertEqual(calculate_federal_tax(31_500, tax_filing_status="married_joint"), 0.0)
        self.assertAlmostEqual(calculate_federal_tax(31_500 + 23_850, tax_filing_status="married_joint"), 2_385.0)
        self.assertEqual(calculate_federal_tax(15_750, tax_filing_status="single"), 0.0)
        self.assertAlmostEqual(calculate_federal_tax(15_750 + 11_925, tax_filing_status="single"), 1_192.5)

    def test_property_sale_is_all_or_nothing_and_retains_excess(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "Rental Portfolio", "value": 200_000, "growth_rate": 0.0, "tax_treatment": "real_estate"}],
            outflows=[{"name": "Living", "amount": 10_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
            allow_property_sale=True,
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        sale = row["withdrawals"][0]
        self.assertTrue(sale["all_or_nothing"])
        self.assertEqual(row["ending_portfolio"]["Rental Portfolio"], 0.0)
        self.assertAlmostEqual(row["cash_reserve"], 170_000.0, places=4)
        self.assertAlmostEqual(row["liquid_net_worth"], 170_000.0, places=4)
        self.assertAlmostEqual(row["property_net_worth"], 0.0, places=4)

    def test_property_sale_reporting_uses_the_property_haircut(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "Rental", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "real_estate"}],
            outflows=[{"name": "Living", "amount": 10_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
            sale_haircut=0.10,
            property_sale_haircut=0.20,
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertEqual(row["tax_brokerage"], 20_000.0)
        self.assertEqual(row["brokerage_withdrawals_after_tax"], 80_000.0)
        self.assertEqual(row["tax_total"], 20_000.0)

    def test_rental_income_stops_after_a_rental_sale(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "Rental", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "real_estate", "property_role": "rental"}],
            inflows=[{"name": "Rent", "income_type": "rental", "amount": 20_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
            outflows=[{"name": "Living", "amount": 100_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertAlmostEqual(rows[0]["income"]["rental_income"], 20_000.0)
        self.assertAlmostEqual(rows[1]["income"]["rental_income"], 0.0)

    def test_multiple_rentals_disclose_the_pooled_income_boundary(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[
                {"name": "Rental A", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "real_estate", "property_role": "rental"},
                {"name": "Rental B", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "real_estate", "property_role": "rental"},
            ],
            inflows=[{"name": "Rent", "income_type": "rental", "amount": 20_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        result = simulate_one(request, mode="custom")
        self.assertIn("POOLED_RENTAL_INCOME", {warning["code"] for warning in result["warnings"]})

    def test_standard_social_security_taxability_is_not_always_full(self):
        request = params(
            current_age=70,
            target_retirement_age=70,
            retirement_withdrawal_age=70,
            plan_through_age=85,
            assets=[{"name": "Roth IRA", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "roth"}],
            inflows=[{"name": "Social Security", "amount": 40_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
            outflows=[{"name": "Living", "amount": 10_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertEqual(row["social_security_taxable_amount"], 0.0)
        self.assertEqual(row["withdrawal_shortfall"], 0.0)
        self.assertEqual(row["requested_withdrawal"], 0.0)
        self.assertAlmostEqual(row["cash_income_before_tax"], 40_000.0)
        self.assertAlmostEqual(row["social_security_after_tax"], 40_000.0)

    def test_explicit_income_type_overrides_display_name(self):
        request = params(
            current_age=70,
            target_retirement_age=70,
            retirement_withdrawal_age=70,
            plan_through_age=85,
            assets=[{"name": "Roth IRA", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "roth"}],
            inflows=[{"name": "Benefit", "income_type": "social_security", "amount": 40_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
            outflows=[{"name": "Living", "amount": 10_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertAlmostEqual(row["income"]["social_security"], 40_000.0)
        self.assertEqual(row["income"]["other_income"], 0.0)

    def test_explicit_bitcoin_type_survives_a_renamed_account(self):
        request = params(
            current_age=38,
            target_retirement_age=60,
            plan_through_age=85,
            assets=[{"name": "Digital Asset", "value": 100_000, "growth_rate": 0.07, "tax_treatment": "bitcoin"}],
            custom_return_sequence=[0.20],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertAlmostEqual(rows[1]["bitcoin"], 107_000.0, places=2)
        self.assertEqual(rows[1]["brokerage"], 0.0)

    def test_explicit_taxable_type_overrides_a_bitcoin_label(self):
        request = params(
            current_age=38,
            target_retirement_age=60,
            plan_through_age=85,
            assets=[{"name": "Bitcoin", "value": 100_000, "growth_rate": 0.07, "tax_treatment": "taxable"}],
            custom_return_sequence=[0.20],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertAlmostEqual(rows[1]["brokerage"], 120_000.0, places=2)
        self.assertEqual(rows[1]["bitcoin"], 0.0)

    def test_explicit_property_role_overrides_the_display_name(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "Primary Home", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "real_estate", "property_role": "rental"}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertAlmostEqual(row["rental_properties"], 100_000.0)
        self.assertEqual(row["primary_home"], 0.0)

    def test_pre_retirement_cash_gap_is_not_silently_ignored(self):
        request = params(
            current_age=38,
            target_retirement_age=60,
            assets=[{"name": "Brokerage", "value": 100_000, "growth_rate": 0.0, "tax_treatment": "taxable"}],
            outflows=[{"name": "Living", "amount": 100_000, "start_year": 2026, "end_year": 2026, "growth_rate": 0.0}],
        )
        result = simulate_one(request, mode="custom")
        row = result["timeline"][0]
        self.assertGreater(row["requested_withdrawal"], 0.0)
        self.assertGreater(row["withdrawal_shortfall"], 0.0)
        self.assertFalse(result["isSuccess"])

    def test_final_plan_age_is_included_in_success_decision(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "Roth IRA", "value": 50_000, "growth_rate": 0.0, "tax_treatment": "roth"}],
            one_time_expenses=[{"name": "Final year cost", "amount": 60_000, "year": 2051}],
        )
        result = simulate_one(request, mode="custom")
        self.assertEqual(result["timeline"][-1]["age"], 85)
        self.assertFalse(result["isSuccess"])
        self.assertEqual(result["firstFailureYear"], 2051)

    def test_global_inflation_stream_uses_cumulative_rate(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            general_inflation=0.05,
            assets=[{"name": "Roth IRA", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "roth"}],
            outflows=[{"name": "Living", "amount": 100_000, "start_year": 2026, "end_year": 2110, "growth_mode": "global", "growth_rate": None}],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertAlmostEqual(rows[0]["total_expenses"], 100_000.0)
        self.assertAlmostEqual(rows[1]["total_expenses"], 105_000.0)
        self.assertAlmostEqual(rows[2]["total_expenses"], 110_250.0)

    def test_adaptive_spending_only_reduces_flexible_outflows(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            plan_through_age=85,
            assets=[{"name": "Roth IRA", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "roth"}],
            custom_return_sequence=[0.0, -0.20],
            outflows=[
                {"name": "Travel", "amount": 100_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0, "discretionary": True},
                {"name": "Housing", "amount": 50_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0, "discretionary": False},
            ],
            spending_rules=[{"stock_down_threshold": 0.10, "reduce_spending_pct": 0.10, "years": 1}],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertAlmostEqual(rows[2]["total_expenses"], 140_000.0)

    def test_contributions_are_routed_when_no_pre_tax_account_exists(self):
        request = params(
            current_age=38,
            target_retirement_age=60,
            plan_through_age=85,
            assets=[{"name": "Brokerage", "value": 0, "growth_rate": 0.0, "tax_treatment": "taxable"}],
            inflows=[{"name": "W2 Salary", "amount": 100_000, "start_year": 2026, "end_year": 2030, "growth_rate": 0.0}],
            outflows=[{"name": "Living", "amount": 50_000, "start_year": 2026, "end_year": 2026, "growth_rate": 0.0}],
            workplace_contribution_limit=50_000,
            employer_match_rate=0.13,
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertAlmostEqual(row["employee_401k_contribution"], 50_000.0)
        self.assertAlmostEqual(row["employer_401k_match"], 13_000.0)
        self.assertEqual(row["contribution_destination"], "Brokerage")
        self.assertGreater(row["ending_portfolio"]["Brokerage"], 0.0)
        self.assertLessEqual(row["ending_portfolio"]["Brokerage"], 63_000.0)

    def test_duplicate_visible_names_are_rejected(self):
        with self.assertRaises(ValueError):
            params(assets=[
                {"name": "Brokerage", "value": 1, "growth_rate": 0.0, "tax_treatment": "taxable"},
                {"name": " brokerage ", "value": 2, "growth_rate": 0.0, "tax_treatment": "taxable"},
            ])


    def test_property_ownership_and_mortgage_schedule_change_equity_and_spending(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            assets=[
                {"name": "Brokerage", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "taxable"},
                {
                    "name": "Shared Home",
                    "value": 1_000_000,
                    "growth_rate": 0.0,
                    "tax_treatment": "real_estate",
                    "property_role": "primary",
                    "ownership_percentage": 0.5,
                    "mortgage_balance": 200_000,
                    "mortgage_interest_rate": 0.0,
                    "mortgage_monthly_payment": 2_000,
                    "mortgage_payments_remaining": 100,
                },
            ],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertEqual(row["mortgage_payment_total"], 24_000)
        self.assertEqual(row["mortgage_principal_total"], 24_000)
        self.assertEqual(row["ending_mortgage_balances"]["Shared Home"], 176_000)
        self.assertEqual(row["property_net_worth"], 324_000)
        self.assertEqual(row["total_expenses"], 24_000)

    def test_zero_percent_property_is_kept_for_reference_but_not_counted(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            assets=[
                {"name": "Brokerage", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "taxable"},
                {
                    "name": "Household Home",
                    "value": 750_000,
                    "growth_rate": 0.0,
                    "tax_treatment": "real_estate",
                    "property_role": "primary",
                    "ownership_percentage": 0.0,
                    "annual_operating_expenses": 20_000,
                },
            ],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertEqual(row["property_net_worth"], 0)
        self.assertEqual(row["property_operating_expenses"], 0)
        self.assertEqual(row["total_expenses"], 0)

    def test_property_value_revenue_and_opex_follow_inflation_and_ownership(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            general_inflation=0.10,
            assets=[
                {"name": "Brokerage", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "taxable"},
                {
                    "name": "Shared Rental",
                    "value": 100_000,
                    "growth_rate": 0.99,
                    "tax_treatment": "real_estate",
                    "property_role": "rental",
                    "ownership_percentage": 0.5,
                    "annual_revenue": 24_000,
                    "annual_operating_expenses": 8_000,
                },
            ],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertEqual(rows[0]["property_net_worth"], 50_000)
        self.assertEqual(rows[0]["property_gross_revenue"], 12_000)
        self.assertEqual(rows[0]["property_operating_expenses"], 4_000)
        self.assertEqual(rows[0]["property_net_operating_income"], 8_000)
        self.assertEqual(rows[1]["property_net_worth"], 55_000)
        self.assertEqual(rows[1]["property_gross_revenue"], 13_200)
        self.assertEqual(rows[1]["property_operating_expenses"], 4_400)
        self.assertEqual(rows[1]["property_net_operating_income"], 8_800)

    def test_negative_property_noi_is_inflation_linked_essential_spending(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            general_inflation=0.05,
            assets=[
                {"name": "Brokerage", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "taxable"},
                {
                    "name": "Primary Home",
                    "value": 500_000,
                    "growth_rate": 0.0,
                    "tax_treatment": "real_estate",
                    "property_role": "primary",
                    "annual_operating_expenses": 10_000,
                },
            ],
        )
        rows = simulate_one(request, mode="custom")["timeline"]
        self.assertEqual(rows[0]["property_operating_shortfall"], 10_000)
        self.assertEqual(rows[0]["total_expenses"], 10_000)
        self.assertEqual(rows[1]["property_operating_shortfall"], 10_500)
        self.assertEqual(rows[1]["total_expenses"], 10_500)

    def test_rental_cash_flow_nets_opex_and_debt_service_without_double_counting(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            assets=[
                {"name": "Brokerage", "value": 1_000_000, "growth_rate": 0.0, "tax_treatment": "taxable"},
                {
                    "name": "Rental A",
                    "value": 300_000,
                    "growth_rate": 0.0,
                    "tax_treatment": "real_estate",
                    "property_role": "rental",
                    "annual_revenue": 30_000,
                    "annual_operating_expenses": 10_000,
                    "mortgage_balance": 100_000,
                    "mortgage_interest_rate": 0.0,
                    "mortgage_monthly_payment": 1_000,
                    "mortgage_payments_remaining": 100,
                },
            ],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        self.assertEqual(row["property_net_operating_income"], 20_000)
        self.assertEqual(row["rental_debt_service_total"], 12_000)
        self.assertEqual(row["rental_cash_flow_before_tax"], 8_000)
        self.assertEqual(row["rental_cash_flow_after_tax"], 8_000)
        self.assertEqual(row["total_expenses"], 12_000)
        self.assertEqual(row["income_chart_expenses"], 0)
        self.assertEqual(row["property_cash_flow_details"][0]["cash_flow_after_debt_service"], 8_000)

    def test_property_sale_pays_mortgage_from_owned_share_before_releasing_cash(self):
        request = params(
            current_age=60,
            target_retirement_age=60,
            retirement_withdrawal_age=60,
            assets=[{
                "name": "Shared Rental",
                "value": 1_000_000,
                "growth_rate": 0.0,
                "tax_treatment": "real_estate",
                "property_role": "rental",
                "ownership_percentage": 0.5,
                "mortgage_balance": 100_000,
            }],
            outflows=[{"name": "Living", "amount": 340_000, "start_year": 2026, "end_year": 2110, "growth_rate": 0.0}],
        )
        row = simulate_one(request, mode="custom")["timeline"][0]
        sale = next(item for item in row["withdrawals"] if item["category"] == "rental")
        self.assertEqual(sale["gross"], 500_000)
        self.assertEqual(sale["haircut_amount"], 50_000)
        self.assertEqual(sale["mortgage_payoff"], 100_000)
        self.assertEqual(sale["net"], 350_000)
        self.assertEqual(row["ending_mortgage_balances"]["Shared Rental"], 0)
        self.assertEqual(row["cash_reserve"], 10_000)


class ApiContractTests(unittest.TestCase):
    def test_monte_carlo_reports_baseline_and_adaptive_rates(self):
        client = TestClient(app)
        payload = params(return_mode="historical").model_dump(mode="json")
        payload["spending_rules"] = [{"stock_down_threshold": 0.1, "reduce_spending_pct": 0.1, "years": 2}]
        response = client.post(
            "/monte_carlo",
            json={"params": payload, "mode": "historical", "num_runs": 1, "seed": 19},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["adaptiveSpendingEnabled"])
        self.assertIn("baselineSuccessRate", body)
        self.assertIn("adaptiveSuccessRate", body)
        self.assertIn("liquid_net_worth", body["percentileData"][0])
        self.assertIn("property_net_worth", body["percentileData"][0])

    def test_inspector_requires_matching_fingerprint(self):
        client = TestClient(app)
        payload = params().model_dump(mode="json")
        aggregate = client.post(
            "/monte_carlo",
            json={"params": payload, "mode": "historical", "num_runs": 1, "seed": 19},
        )
        self.assertEqual(aggregate.status_code, 200)
        body = aggregate.json()
        inspected = client.post(
            "/monte_carlo_run",
            json={"params": payload, "mode": "historical", "num_runs": 1, "run_index": 0, "seed": 19, "fingerprint": body["fingerprint"]},
        )
        self.assertEqual(inspected.status_code, 200)
        mismatch = client.post(
            "/monte_carlo_run",
            json={"params": payload, "mode": "historical", "num_runs": 1, "run_index": 0, "seed": 20, "fingerprint": body["fingerprint"]},
        )
        self.assertEqual(mismatch.status_code, 422)
        self.assertEqual(mismatch.json()["error"]["code"], "FINGERPRINT_MISMATCH")

    def test_request_token_does_not_change_plan_fingerprint(self):
        first = params(request_token="attempt-a")
        second = params(request_token="attempt-b")
        kwargs = {
            "mode": "custom",
            "num_runs": 1,
            "stock_volatility": 0.0,
            "real_estate_volatility": 0.0,
            "inflation_volatility": 0.0,
            "seed": 0,
        }
        self.assertEqual(request_fingerprint(first, **kwargs), request_fingerprint(second, **kwargs))

    def test_monte_carlo_accepts_and_echoes_request_token(self):
        client = TestClient(app)
        payload = params(return_mode="historical").model_dump(mode="json")
        response = client.post(
            "/monte_carlo",
            json={"params": payload, "mode": "historical", "num_runs": 1, "seed": 19, "request_token": "browser-run-1"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["requestToken"], "browser-run-1")

    def test_plan_rejects_events_outside_the_modeled_horizon(self):
        with self.assertRaises(ValueError):
            params(one_time_expenses=[{"name": "Too late", "amount": 1, "year": 2200}])

    def test_plan_rejects_recurring_streams_that_never_overlap_the_horizon(self):
        with self.assertRaises(ValueError):
            params(outflows=[{"name": "Too late", "amount": 1, "start_year": 2200, "end_year": 2201, "growth_rate": 0.0}])

    def test_monte_carlo_rejects_unbounded_workloads(self):
        client = TestClient(app)
        payload = params(return_mode="historical").model_dump(mode="json")
        response = client.post("/monte_carlo", json={"params": payload, "mode": "historical", "num_runs": 5001})
        self.assertEqual(response.status_code, 422)

    def test_full_employer_match_cap_is_allowed(self):
        request = params(employer_match_rate=1.0)
        self.assertEqual(request.employer_match_rate, 1.0)

    def test_withdrawal_order_cannot_silently_omit_a_source(self):
        with self.assertRaises(ValueError):
            params(withdrawal_order=["rmds", "taxable", "bitcoin", "pre_tax", "roth", "rental"])


if __name__ == "__main__":
    unittest.main()
