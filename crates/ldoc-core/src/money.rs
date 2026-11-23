use serde::Serialize;
use std::fmt;

/// An amount of Korean won. Never negative, never fractional.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Won(u64);

const DIGITS: [&str; 10] = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const PLACES: [&str; 4] = ["", "십", "백", "천"];
const GROUPS: [&str; 5] = ["", "만", "억", "조", "경"];

impl Won {
    pub const fn new(amount: u64) -> Self {
        Won(amount)
    }

    pub const fn amount(self) -> u64 {
        self.0
    }

    /// The largest amount the core reads: 999조 9999억 9999만 9999원. Every
    /// fee computed from an amount up to this fits in a `u64`.
    pub const MAX: Won = Won(999_999_999_999_999);

    /// Reads what a person types into a money field: digits, optionally
    /// grouped in threes by commas, and an optional trailing "원". Spaces
    /// inside the figure are not read, so `10 000 00` is refused rather
    /// than guessed at.
    pub fn parse(input: &str) -> Option<Won> {
        let input = input.trim();
        let figure = input.strip_suffix('원').map_or(input, str::trim_end);
        let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
        let mut groups = figure.split(',');
        let head = groups.next()?;
        let grouped = figure.contains(',');
        if !digits(head)
            || (grouped && head.len() > 3)
            || !groups.all(|group| group.len() == 3 && digits(group))
        {
            return None;
        }
        let amount: u64 = figure.replace(',', "").parse().ok()?;
        (amount <= Self::MAX.0).then_some(Won(amount))
    }

    pub fn checked_sub(self, other: Won) -> Option<Won> {
        self.0.checked_sub(other.0).map(Won)
    }

    /// `10,000,000`
    pub fn with_commas(self) -> String {
        let digits = self.0.to_string();
        let mut out = String::with_capacity(digits.len() + digits.len() / 3);
        for (index, digit) in digits.chars().enumerate() {
            if index > 0 && (digits.len() - index).is_multiple_of(3) {
                out.push(',');
            }
            out.push(digit);
        }
        out
    }

    /// The amount in Korean numerals, with every "일" written out so the
    /// figure cannot be altered by adding a stroke: `일천만`.
    pub fn in_korean(self) -> String {
        if self.0 == 0 {
            return "영".to_string();
        }
        let mut groups = Vec::new();
        let mut rest = self.0;
        while rest > 0 {
            groups.push(rest % 10_000);
            rest /= 10_000;
        }
        let mut out = String::new();
        for (group_index, group) in groups.iter().enumerate().rev() {
            if *group == 0 {
                continue;
            }
            for place in (0..4).rev() {
                let digit = (group / 10u64.pow(place)) % 10;
                if digit > 0 {
                    out.push_str(DIGITS[digit as usize]);
                    out.push_str(PLACES[place as usize]);
                }
            }
            out.push_str(GROUPS[group_index]);
        }
        out
    }
}

impl fmt::Display for Won {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}원", self.with_commas())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_typed_amounts() {
        assert_eq!(Won::parse("10,000,000"), Some(Won::new(10_000_000)));
        assert_eq!(Won::parse(" 5500원 "), Some(Won::new(5_500)));
        assert_eq!(Won::parse("0"), Some(Won::new(0)));
    }

    #[test]
    fn rejects_what_is_not_an_amount() {
        for input in ["", "천만원", "-500", "1.5", "1e6", "500원원"] {
            assert_eq!(Won::parse(input), None, "{input:?}");
        }
    }

    #[test]
    fn reads_commas_only_as_groups_of_three() {
        assert_eq!(Won::parse("1,000"), Some(Won::new(1_000)));
        assert_eq!(Won::parse("12,345,678원"), Some(Won::new(12_345_678)));
        for input in ["10,000,00", "1,0000", ",100", "100,", "1,,000", "1000,000"] {
            assert_eq!(Won::parse(input), None, "{input:?}");
        }
    }

    #[test]
    fn spaces_inside_an_amount_are_not_read() {
        assert_eq!(Won::parse("5,500 원"), Some(Won::new(5_500)));
        for input in ["10 000 00", "1 000", "1, 000", "1 ,000"] {
            assert_eq!(Won::parse(input), None, "{input:?}");
        }
    }

    #[test]
    fn amounts_stop_below_a_thousand_trillion() {
        assert_eq!(
            Won::parse("999,999,999,999,999"),
            Some(Won::new(999_999_999_999_999))
        );
        for input in [
            "1,000,000,000,000,000",
            "1000000000000000",
            "18446744073709551616",
        ] {
            assert_eq!(Won::parse(input), None, "{input:?}");
        }
    }

    #[test]
    fn groups_digits_in_threes() {
        assert_eq!(Won::new(0).with_commas(), "0");
        assert_eq!(Won::new(999).with_commas(), "999");
        assert_eq!(Won::new(1_000).with_commas(), "1,000");
        assert_eq!(Won::new(66_000).with_commas(), "66,000");
        assert_eq!(Won::new(1_234_567_890).with_commas(), "1,234,567,890");
    }

    #[test]
    fn writes_amounts_in_korean() {
        let cases = [
            (0, "영"),
            (66_000, "육만육천"),
            (10_000_000, "일천만"),
            (11_110_000, "일천일백일십일만"),
            (100_000_000, "일억"),
            (100_010_000, "일억일만"),
            (1_234_567_890, "일십이억삼천사백오십육만칠천팔백구십"),
            (2_000_000_000_000, "이조"),
        ];
        for (amount, expected) in cases {
            assert_eq!(Won::new(amount).in_korean(), expected, "{amount}");
        }
    }

    #[test]
    fn subtraction_refuses_to_go_negative() {
        assert_eq!(
            Won::new(500).checked_sub(Won::new(200)),
            Some(Won::new(300))
        );
        assert_eq!(Won::new(200).checked_sub(Won::new(500)), None);
    }
}
