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
        assert_eq!(tokens::dark::BG_CHROME, "#161717");
        assert_eq!(tokens::light::BG_CHROME, "#E8EAEA");
        assert_eq!(tokens::dark::BG_CANVAS, "#1F2121");
        assert_eq!(tokens::light::BG_CANVAS, "#F4F5F6");
        assert_eq!(tokens::dark::TEXT_PRIMARY, "#ECEFF1");
        assert_eq!(tokens::light::TEXT_PRIMARY, "#161717");
        assert_eq!(tokens::dark::ACCENT_PRIMARY, "#7DD9EE");
        assert_eq!(tokens::light::ACCENT_PRIMARY, "#1497B8");
        assert_eq!(tokens::dark::ACCENT_ON, "#0E1A1D");
        assert_eq!(tokens::dark::BOX_FILL, "#1A1B1B");
        assert_eq!(tokens::light::BOX_FILL, "#FFFFFF");
        assert_eq!(tokens::dark::FRAME_BORDER_FOCUS, "rgba(255,255,255,0.50)");
        assert_eq!(tokens::dark::EDGE_HI, "#FFFFFF");
        assert_eq!(tokens::layout::BOX_S, 120);
        assert_eq!(tokens::layout::FRAME_PAD, 30);
        assert_eq!(tokens::layout::FRAME_HEADER, 72);
        assert_eq!(tokens::spacing::SPACE_4, 16);
        assert_eq!(tokens::radii::BOX, 8);
        assert_eq!(tokens::font_size::TITLE_SM, 14);
        assert_eq!(tokens::dark::tags::blue::FG, "#BFDBFE");
        assert_eq!(tokens::light::tags::blue::FG, "#1E40AF");
    }
}
