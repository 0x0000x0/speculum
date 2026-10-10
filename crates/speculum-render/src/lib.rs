pub mod tokens;

pub fn placeholder() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_is_true() {
        assert!(placeholder());
    }

    #[test]
    fn tokens_match_source_of_truth() {
        // Spot-check generated constants (full coverage lives in
        // tools/check-tokens.mjs). Fails if generation drifts.
        assert_eq!(tokens::dark::BG_CHROME, "#0E1116");
        assert_eq!(tokens::light::BG_CHROME, "#F7F7F8");
        assert_eq!(tokens::dark::TEXT_PRIMARY, "#F3F5F9");
        assert_eq!(tokens::light::TEXT_PRIMARY, "#111827");
        assert_eq!(tokens::dark::ACCENT_ON, "#FFFFFF");
        assert_eq!(tokens::spacing::SPACE_4, 16);
        assert_eq!(tokens::radii::BOX, 8);
        assert_eq!(tokens::font_size::TITLE_SM, 14);
        assert_eq!(tokens::dark::tags::blue::FG, "#BFDBFE");
        assert_eq!(tokens::light::tags::blue::FG, "#1E40AF");
    }
}
