//! Figures that statute or court notice changes over time. Each table lists
//! the date a value took effect, oldest first.

use crate::money::Won;
use jiff::civil::{Date, date};

pub struct Dated<T: 'static>(&'static [(Date, T)]);

impl<T: Copy> Dated<T> {
    /// The value in force on `day`, or `None` when the table does not reach
    /// back that far.
    pub fn on(&self, day: Date) -> Option<T> {
        self.0
            .iter()
            .rev()
            .find(|(from, _)| *from <= day)
            .map(|(_, value)| *value)
    }
}

/// One round of service of process, set by court notice.
/// Source: drafting guide doc-125, "2025년 6월 이후 5,500원".
pub const SERVICE_UNIT: Dated<Won> = Dated(&[(date(2025, 6, 1), Won::new(5_500))]);

/// Rounds of service prepaid in a payment order case (독촉사건).
pub const PAYMENT_ORDER_SERVICE_ROUNDS: u64 = 6;

/// Annual delay rate after service, 소송촉진 등에 관한 특례법 제3조 and its
/// enforcement decree.
pub const LITIGATION_DELAY_PERCENT: Dated<u32> = Dated(&[(date(2019, 6, 1), 12)]);

/// 민법 제379조.
pub const CIVIL_PERCENT: u32 = 5;

/// 상법 제54조.
pub const COMMERCIAL_PERCENT: u32 = 6;

#[cfg(test)]
mod tests {
    use super::*;

    const STEPS: Dated<u32> = Dated(&[(date(2020, 1, 1), 1), (date(2022, 7, 1), 2)]);

    #[test]
    fn a_value_applies_from_its_effective_date_until_the_next() {
        assert_eq!(STEPS.on(date(2020, 1, 1)), Some(1));
        assert_eq!(STEPS.on(date(2022, 6, 30)), Some(1));
        assert_eq!(STEPS.on(date(2022, 7, 1)), Some(2));
        assert_eq!(STEPS.on(date(2030, 1, 1)), Some(2));
    }

    #[test]
    fn no_value_before_the_first_entry() {
        assert_eq!(STEPS.on(date(2019, 12, 31)), None);
    }
}
