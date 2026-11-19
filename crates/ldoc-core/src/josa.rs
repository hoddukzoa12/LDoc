//! Korean particles change with the last sound of the word before them.

/// `Some(true)` when the word ends in a Hangul syllable with a final
/// consonant, `Some(false)` when it ends in one without, `None` when the
/// last character is not Hangul and the sound cannot be told from spelling.
fn ends_in_consonant(word: &str) -> Option<bool> {
    let last = word.trim_end().chars().next_back()?;
    let code = last as u32;
    (0xAC00..=0xD7A3)
        .contains(&code)
        .then(|| !(code - 0xAC00).is_multiple_of(28))
}

fn pick(
    word: &str,
    after_consonant: &'static str,
    after_vowel: &'static str,
    unknown: &'static str,
) -> &'static str {
    match ends_in_consonant(word) {
        Some(true) => after_consonant,
        Some(false) => after_vowel,
        None => unknown,
    }
}

/// 을 / 를
pub fn object(word: &str) -> &'static str {
    pick(word, "을", "를", "을(를)")
}

/// 이라는 / 라는
pub fn called(word: &str) -> &'static str {
    pick(word, "이라는", "라는", "(이)라는")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn particle_follows_the_final_sound() {
        assert_eq!(object("냉동 수산물"), "을");
        assert_eq!(object("포장 박스"), "를");
        assert_eq!(called("가나상사"), "라는");
        assert_eq!(called("한빛유통"), "이라는");
    }

    #[test]
    fn both_forms_when_the_sound_is_unknown() {
        assert_eq!(object("A4 용지 200box"), "을(를)");
        assert_eq!(called("ABC"), "(이)라는");
    }
}
