//! Pure payroll math. Amounts are THB, rounded half-up to 2 decimals.
//!
//! Thai social security (SSO): 5% of the salary base capped at 15,000 THB
//! per month, i.e. at most 750 THB, contributed by BOTH employee and
//! employer.
//!
//! Withholding tax uses the standard employer method for regular salary:
//! project the month to a full year (salary × 12), deduct employment
//! expenses (50% capped at 100,000/yr), the personal allowance (60,000/yr),
//! and the employee's annual SSO contribution, run the progressive personal
//! income tax brackets over the taxable remainder, then withhold 1/12 of
//! the annual tax each month.

use serde::{Deserialize, Serialize};

pub const SSO_RATE: f64 = 0.05;
pub const SSO_BASE_CAP: f64 = 15_000.0;

pub const EXPENSE_DEDUCTION_RATE: f64 = 0.5;
pub const EXPENSE_DEDUCTION_CAP: f64 = 100_000.0;
pub const PERSONAL_ALLOWANCE: f64 = 60_000.0;

/// Progressive personal income tax brackets (annual taxable income, THB):
/// upper bound of the bracket and its marginal rate. The last bracket is
/// unbounded.
pub const TAX_BRACKETS: [(f64, f64); 8] = [
    (150_000.0, 0.00),
    (300_000.0, 0.05),
    (500_000.0, 0.10),
    (750_000.0, 0.15),
    (1_000_000.0, 0.20),
    (2_000_000.0, 0.25),
    (5_000_000.0, 0.30),
    (f64::INFINITY, 0.35),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeInput {
    pub id: String,
    pub salary: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayrollLine {
    pub id: String,
    pub gross: f64,
    pub sso_employee: f64,
    pub sso_employer: f64,
    pub wht: f64,
    pub net: f64,
}

#[derive(Debug, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayrollTotals {
    pub gross: f64,
    pub sso_employee: f64,
    pub sso_employer: f64,
    pub wht: f64,
    pub net: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollResult {
    pub lines: Vec<PayrollLine>,
    pub totals: PayrollTotals,
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Progressive tax over an annual taxable income.
pub fn annual_tax(taxable: f64) -> f64 {
    let mut tax = 0.0;
    let mut lower = 0.0;
    for (upper, rate) in TAX_BRACKETS {
        if taxable <= lower {
            break;
        }
        let slice = taxable.min(upper) - lower;
        tax += slice * rate;
        lower = upper;
    }
    tax
}

/// Monthly withholding for a regular salary: annualize, deduct, tax, /12.
pub fn monthly_wht(salary: f64, monthly_sso_employee: f64) -> f64 {
    let annual_income = salary * 12.0;
    let expense = (annual_income * EXPENSE_DEDUCTION_RATE).min(EXPENSE_DEDUCTION_CAP);
    let sso_deduction = monthly_sso_employee * 12.0;
    let taxable = (annual_income - expense - PERSONAL_ALLOWANCE - sso_deduction).max(0.0);
    round2(annual_tax(taxable) / 12.0)
}

pub fn calculate_line(input: &EmployeeInput) -> Result<PayrollLine, String> {
    if !input.salary.is_finite() || input.salary <= 0.0 {
        return Err(format!("employee {}: salary must be positive", input.id));
    }
    let gross = round2(input.salary);
    let sso_base = input.salary.min(SSO_BASE_CAP);
    let sso = round2(sso_base * SSO_RATE);
    let wht = monthly_wht(input.salary, sso);
    let net = round2(gross - sso - wht);
    if net < 0.0 {
        return Err(format!("employee {}: deductions exceed salary", input.id));
    }
    Ok(PayrollLine {
        id: input.id.clone(),
        gross,
        sso_employee: sso,
        sso_employer: sso,
        wht,
        net,
    })
}

pub fn calculate(employees: &[EmployeeInput]) -> Result<PayrollResult, String> {
    if employees.is_empty() {
        return Err("no employees to calculate".to_string());
    }
    let mut lines = Vec::with_capacity(employees.len());
    let mut totals = PayrollTotals::default();
    for employee in employees {
        let line = calculate_line(employee)?;
        totals.gross = round2(totals.gross + line.gross);
        totals.sso_employee = round2(totals.sso_employee + line.sso_employee);
        totals.sso_employer = round2(totals.sso_employer + line.sso_employer);
        totals.wht = round2(totals.wht + line.wht);
        totals.net = round2(totals.net + line.net);
        lines.push(line);
    }
    Ok(PayrollResult { lines, totals })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn emp(id: &str, salary: f64) -> EmployeeInput {
        EmployeeInput { id: id.to_string(), salary }
    }

    #[test]
    fn sso_is_five_percent_below_cap() {
        let line = calculate_line(&emp("a", 10_000.0)).unwrap();
        assert_eq!(line.sso_employee, 500.0);
        assert_eq!(line.sso_employer, 500.0);
        // 120,000/yr − 60,000 expense − 60,000 allowance − 6,000 SSO < 0 → no tax
        assert_eq!(line.wht, 0.0);
        assert_eq!(line.net, 9_500.0);
    }

    #[test]
    fn sso_caps_at_750() {
        let line = calculate_line(&emp("a", 50_000.0)).unwrap();
        assert_eq!(line.sso_employee, 750.0);
    }

    #[test]
    fn low_income_pays_no_tax() {
        // 22,000/mo → 264,000/yr − 100,000 − 60,000 − 9,000 = 95,000 ≤ 150,000
        let line = calculate_line(&emp("a", 22_000.0)).unwrap();
        assert_eq!(line.wht, 0.0);
        assert_eq!(line.net, 21_250.0);
    }

    #[test]
    fn brackets_apply_progressively() {
        // 65,000/mo → 780,000/yr − 169,000 = 611,000 taxable
        //   150k@0 + 150k@5% (7,500) + 200k@10% (20,000) + 111k@15% (16,650)
        //   = 44,150/yr → 3,679.17/mo
        let line = calculate_line(&emp("a", 65_000.0)).unwrap();
        assert_eq!(line.wht, 3_679.17);
        assert_eq!(line.net, 65_000.0 - 750.0 - 3_679.17);
    }

    #[test]
    fn mid_bracket_value() {
        // 45,000/mo → 540,000/yr − 169,000 = 371,000 taxable
        //   7,500 + 71,000@10% = 14,600/yr → 1,216.67/mo
        let line = calculate_line(&emp("a", 45_000.0)).unwrap();
        assert_eq!(line.wht, 1_216.67);
    }

    #[test]
    fn top_bracket_reached() {
        // 500,000/mo → 6,000,000/yr − 100,000 − 60,000 − 9,000 = 5,831,000
        // tax = 7,500+20,000+37,500+50,000+250,000+900,000 + 831,000@35% (290,850)
        //     = 1,555,850/yr → 129,654.17/mo
        let line = calculate_line(&emp("a", 500_000.0)).unwrap();
        assert_eq!(line.wht, 129_654.17);
    }

    #[test]
    fn annual_tax_boundaries() {
        assert_eq!(annual_tax(150_000.0), 0.0);
        assert_eq!(annual_tax(300_000.0), 7_500.0);
        assert_eq!(annual_tax(500_000.0), 27_500.0);
        assert_eq!(annual_tax(750_000.0), 65_000.0);
        assert_eq!(annual_tax(1_000_000.0), 115_000.0);
        assert_eq!(annual_tax(2_000_000.0), 365_000.0);
        assert_eq!(annual_tax(5_000_000.0), 1_265_000.0);
    }

    #[test]
    fn totals_add_up_and_identity_holds() {
        let result = calculate(&[emp("a", 65_000.0), emp("b", 12_000.0)]).unwrap();
        assert_eq!(result.totals.gross, 77_000.0);
        // gross == ssoEmployee + wht + net (the GL posting identity)
        let lhs = result.totals.gross;
        let rhs = result.totals.sso_employee + result.totals.wht + result.totals.net;
        assert!((lhs - rhs).abs() < 0.005, "identity broken: {lhs} vs {rhs}");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(calculate_line(&emp("a", 0.0)).is_err());
        assert!(calculate_line(&emp("a", -5.0)).is_err());
        assert!(calculate(&[]).is_err());
    }
}
