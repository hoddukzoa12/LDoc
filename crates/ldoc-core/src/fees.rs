//! Court fees under 민사소송 등 인지법 and the service-of-process deposit.

use crate::money::Won;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filing {
    Electronic,
    Paper,
}

/// 제2조 제2항: below 1,000 won the fee is 1,000 won, and above that
/// anything under 100 won is dropped.
fn settle(raw: u64) -> Won {
    if raw < 1_000 {
        Won::new(1_000)
    } else {
        Won::new(raw / 100 * 100)
    }
}

/// The stamp fee on a complaint for a claim of this size (제2조 제1항).
pub fn complaint_stamp(claim: Won) -> Won {
    let claim = claim.amount();
    let raw = match claim {
        0..10_000_000 => claim * 50 / 10_000,
        10_000_000..100_000_000 => claim * 45 / 10_000 + 5_000,
        100_000_000..1_000_000_000 => claim * 40 / 10_000 + 55_000,
        1_000_000_000.. => claim * 35 / 10_000 + 555_000,
    };
    settle(raw)
}

/// The stamp fee on a payment order application: a tenth of the complaint
/// fee (제7조 제2항), and nine tenths of that when filed electronically
/// (제16조).
pub fn payment_order_stamp(claim: Won, filing: Filing) -> Won {
    let fee = settle(complaint_stamp(claim).amount() / 10);
    match filing {
        Filing::Paper => fee,
        Filing::Electronic => settle(fee.amount() * 9 / 10),
    }
}

/// Parties × one round × number of rounds.
pub fn service_fee(parties: u64, unit: Won, rounds: u64) -> Won {
    Won::new(parties * unit.amount() * rounds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn won(amount: u64) -> Won {
        Won::new(amount)
    }

    #[test]
    fn complaint_stamp_follows_the_four_statutory_brackets() {
        assert_eq!(complaint_stamp(won(5_000_000)), won(25_000));
        assert_eq!(complaint_stamp(won(10_000_000)), won(50_000));
        assert_eq!(complaint_stamp(won(100_000_000)), won(455_000));
        assert_eq!(complaint_stamp(won(1_000_000_000)), won(4_055_000));
    }

    #[test]
    fn complaint_stamp_drops_anything_under_a_hundred_won() {
        // 9,999,999 × 0.005 = 49,999.995
        assert_eq!(complaint_stamp(won(9_999_999)), won(49_900));
    }

    #[test]
    fn complaint_stamp_is_never_under_a_thousand_won() {
        // 100,000 × 0.005 = 500
        assert_eq!(complaint_stamp(won(100_000)), won(1_000));
    }

    #[test]
    fn payment_order_stamp_is_a_tenth_of_the_complaint_fee() {
        assert_eq!(
            payment_order_stamp(won(10_000_000), Filing::Paper),
            won(5_000)
        );
        assert_eq!(
            payment_order_stamp(won(100_000_000), Filing::Paper),
            won(45_500)
        );
    }

    #[test]
    fn electronic_filing_takes_a_further_tenth_off() {
        assert_eq!(
            payment_order_stamp(won(10_000_000), Filing::Electronic),
            won(4_500)
        );
        // 2,500 × 0.9 = 2,250, then under-100 dropped
        assert_eq!(
            payment_order_stamp(won(5_000_000), Filing::Electronic),
            won(2_200)
        );
        // 45,500 × 0.9 = 40,950
        assert_eq!(
            payment_order_stamp(won(100_000_000), Filing::Electronic),
            won(40_900)
        );
    }

    #[test]
    fn the_thousand_won_floor_survives_both_reductions() {
        assert_eq!(payment_order_stamp(won(100_000), Filing::Paper), won(1_000));
        assert_eq!(
            payment_order_stamp(won(100_000), Filing::Electronic),
            won(1_000)
        );
    }

    #[test]
    fn service_fee_matches_the_guide_example() {
        // 채권자 1, 채무자 1: 2 × 5,500원 × 6회 = 66,000원
        assert_eq!(service_fee(2, won(5_500), 6), won(66_000));
    }
}
