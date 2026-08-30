//! Pure payroll math. Amounts are THB, rounded half-up to 2 decimals.
//!
//! Thai social security (SSO): 5% of the salary base capped at 15,000 THB
//! per month, i.e. at most 750 THB, contributed by BOTH employee and
//! employer. Withholding tax here is a per-employee flat rate (a projected
//! effective rate supplied by the caller) — progressive brackets can layer
//! on later without changing the wire contract.

use serde::{Deserialize, Serialize};

pub const SSO_RATE: f64 = 0.05;
pub const SSO_BASE_CAP: f64 = 15_000.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeInput {
    pub id: String,
    pub salary: f64,
    #[serde(default)]
    pub wht_rate: f64,
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

pub fn calculate_line(input: &EmployeeInput) -> Result<PayrollLine, String> {
    if !input.salary.is_finite() || input.salary <= 0.0 {
        return Err(format!("employee {}: salary must be positive", input.id));
    }
    if !input.wht_rate.is_finite() || input.wht_rate < 0.0 || input.wht_rate > 100.0 {
        return Err(format!("employee {}: whtRate must be within 0..100", input.id));
    }
    let gross = round2(input.salary);
    let sso_base = input.salary.min(SSO_BASE_CAP);
    let sso = round2(sso_base * SSO_RATE);
    let wht = round2(input.salary * input.wht_rate / 100.0);
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

    fn emp(id: &str, salary: f64, wht: f64) -> EmployeeInput {
        EmployeeInput { id: id.to_string(), salary, wht_rate: wht }
    }

    #[test]
    fn sso_is_five_percent_below_cap() {
        let line = calculate_line(&emp("a", 10_000.0, 0.0)).unwrap();
        assert_eq!(line.sso_employee, 500.0);
        assert_eq!(line.sso_employer, 500.0);
        assert_eq!(line.net, 9_500.0);
    }

    #[test]
    fn sso_caps_at_750() {
        let line = calculate_line(&emp("a", 50_000.0, 0.0)).unwrap();
        assert_eq!(line.sso_employee, 750.0);
        assert_eq!(line.net, 49_250.0);
    }

    #[test]
    fn wht_rate_applies_to_full_salary() {
        let line = calculate_line(&emp("a", 30_000.0, 3.0)).unwrap();
        assert_eq!(line.wht, 900.0);
        assert_eq!(line.net, 30_000.0 - 750.0 - 900.0);
    }

    #[test]
    fn totals_add_up_and_identity_holds() {
        let result = calculate(&[emp("a", 30_000.0, 3.0), emp("b", 12_000.0, 0.0)]).unwrap();
        assert_eq!(result.totals.gross, 42_000.0);
        // gross == ssoEmployee + wht + net (the GL posting identity)
        let lhs = result.totals.gross;
        let rhs = result.totals.sso_employee + result.totals.wht + result.totals.net;
        assert!((lhs - rhs).abs() < 0.005, "identity broken: {lhs} vs {rhs}");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(calculate_line(&emp("a", 0.0, 0.0)).is_err());
        assert!(calculate_line(&emp("a", -5.0, 0.0)).is_err());
        assert!(calculate_line(&emp("a", 1_000.0, 150.0)).is_err());
        assert!(calculate(&[]).is_err());
    }
}
