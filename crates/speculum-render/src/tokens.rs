//! GENERATED — do not edit by hand. Source: tokens/tokens.json.
//! Regenerate with: node tools/gen-tokens.mjs.

/// Design tokens for the `dark` theme (CSS hex / rgba strings).
pub mod dark {
    pub const BG_CHROME: &str = "#0E1116";
    pub const BG_CANVAS: &str = "#131720";
    pub const BG_CANVAS_DOT: &str = "#3B4A63";
    pub const BG_RAISED: &str = "#1A212E";
    pub const BG_HOVER: &str = "rgba(255,255,255,0.06)";
    pub const BORDER_SUBTLE: &str = "#2A3344";
    pub const BORDER_STRONG: &str = "#3D4A61";
    pub const TEXT_PRIMARY: &str = "#F3F5F9";
    pub const TEXT_SECONDARY: &str = "#A9B4C7";
    pub const TEXT_TERTIARY: &str = "#6B768C";
    pub const ACCENT_PRIMARY: &str = "#3B69FF";
    pub const ACCENT_ON: &str = "#FFFFFF";
    pub const ACCENT_SECONDARY: &str = "#8B5CF6";
    pub const STATE_SUCCESS: &str = "#34D399";
    pub const STATE_WARNING: &str = "#FBBF24";
    pub const STATE_DANGER: &str = "#F87171";
    pub const STATE_INFO: &str = "#60A5FA";
    pub const FOCUS_RING: &str = "#3B69FF";
    pub const SELECTION_FILL: &str = "rgba(59,105,255,0.12)";
    pub const SHADOW_L1: &str = "0 1px 2px rgba(0,0,0,0.18)";
    pub const SHADOW_L2: &str = "0 4px 12px rgba(0,0,0,0.25)";
    pub const SHADOW_L3: &str = "0 12px 32px rgba(0,0,0,0.35)";

    /// Tag palette for the `dark` theme.
    pub mod tags {
        pub mod slate {
            pub const BG: &str = "rgba(100,116,139,0.20)";
            pub const FG: &str = "#CBD5E1";
            pub const BORDER: &str = "rgba(100,116,139,0.35)";
        }
        pub mod blue {
            pub const BG: &str = "rgba(59,130,246,0.20)";
            pub const FG: &str = "#BFDBFE";
            pub const BORDER: &str = "rgba(59,130,246,0.35)";
        }
        pub mod violet {
            pub const BG: &str = "rgba(139,92,246,0.20)";
            pub const FG: &str = "#DDD6FE";
            pub const BORDER: &str = "rgba(139,92,246,0.35)";
        }
        pub mod purple {
            pub const BG: &str = "rgba(168,85,247,0.20)";
            pub const FG: &str = "#E9D5FF";
            pub const BORDER: &str = "rgba(168,85,247,0.35)";
        }
        pub mod pink {
            pub const BG: &str = "rgba(236,72,153,0.20)";
            pub const FG: &str = "#FBCFE8";
            pub const BORDER: &str = "rgba(236,72,153,0.35)";
        }
        pub mod red {
            pub const BG: &str = "rgba(239,68,68,0.20)";
            pub const FG: &str = "#FECACA";
            pub const BORDER: &str = "rgba(239,68,68,0.35)";
        }
        pub mod orange {
            pub const BG: &str = "rgba(249,115,22,0.20)";
            pub const FG: &str = "#FED7AA";
            pub const BORDER: &str = "rgba(249,115,22,0.35)";
        }
        pub mod amber {
            pub const BG: &str = "rgba(245,158,11,0.20)";
            pub const FG: &str = "#FDE68A";
            pub const BORDER: &str = "rgba(245,158,11,0.35)";
        }
        pub mod lime {
            pub const BG: &str = "rgba(132,204,22,0.20)";
            pub const FG: &str = "#D9F99D";
            pub const BORDER: &str = "rgba(132,204,22,0.35)";
        }
        pub mod green {
            pub const BG: &str = "rgba(34,197,94,0.20)";
            pub const FG: &str = "#BBF7D0";
            pub const BORDER: &str = "rgba(34,197,94,0.35)";
        }
        pub mod teal {
            pub const BG: &str = "rgba(20,184,166,0.20)";
            pub const FG: &str = "#99F6E4";
            pub const BORDER: &str = "rgba(20,184,166,0.35)";
        }
        pub mod cyan {
            pub const BG: &str = "rgba(6,182,212,0.20)";
            pub const FG: &str = "#A5F3FC";
            pub const BORDER: &str = "rgba(6,182,212,0.35)";
        }
    }
}

/// Design tokens for the `light` theme (CSS hex / rgba strings).
pub mod light {
    pub const BG_CHROME: &str = "#F7F7F8";
    pub const BG_CANVAS: &str = "#FFFFFF";
    pub const BG_CANVAS_DOT: &str = "#C9D0DB";
    pub const BG_RAISED: &str = "#FFFFFF";
    pub const BG_HOVER: &str = "rgba(17,24,39,0.05)";
    pub const BORDER_SUBTLE: &str = "#E5E7EB";
    pub const BORDER_STRONG: &str = "#CBD2DC";
    pub const TEXT_PRIMARY: &str = "#111827";
    pub const TEXT_SECONDARY: &str = "#4B5563";
    pub const TEXT_TERTIARY: &str = "#6B7280";
    pub const ACCENT_PRIMARY: &str = "#2B64F5";
    pub const ACCENT_ON: &str = "#FFFFFF";
    pub const ACCENT_SECONDARY: &str = "#7C3AED";
    pub const STATE_SUCCESS: &str = "#047857";
    pub const STATE_WARNING: &str = "#B45309";
    pub const STATE_DANGER: &str = "#DC2626";
    pub const STATE_INFO: &str = "#1D4ED8";
    pub const FOCUS_RING: &str = "#2B64F5";
    pub const SELECTION_FILL: &str = "rgba(43,100,245,0.12)";
    pub const SHADOW_L1: &str = "0 1px 2px rgba(0,0,0,0.08)";
    pub const SHADOW_L2: &str = "0 4px 12px rgba(0,0,0,0.12)";
    pub const SHADOW_L3: &str = "0 12px 32px rgba(0,0,0,0.18)";

    /// Tag palette for the `light` theme.
    pub mod tags {
        pub mod slate {
            pub const BG: &str = "#F1F5F9";
            pub const FG: &str = "#1E293B";
            pub const BORDER: &str = "transparent";
        }
        pub mod blue {
            pub const BG: &str = "#DBEAFE";
            pub const FG: &str = "#1E40AF";
            pub const BORDER: &str = "transparent";
        }
        pub mod violet {
            pub const BG: &str = "#EDE9FE";
            pub const FG: &str = "#5B21B6";
            pub const BORDER: &str = "transparent";
        }
        pub mod purple {
            pub const BG: &str = "#F3E8FF";
            pub const FG: &str = "#6B21A8";
            pub const BORDER: &str = "transparent";
        }
        pub mod pink {
            pub const BG: &str = "#FCE7F3";
            pub const FG: &str = "#9D174D";
            pub const BORDER: &str = "transparent";
        }
        pub mod red {
            pub const BG: &str = "#FEE2E2";
            pub const FG: &str = "#991B1B";
            pub const BORDER: &str = "transparent";
        }
        pub mod orange {
            pub const BG: &str = "#FFEDD5";
            pub const FG: &str = "#9A3412";
            pub const BORDER: &str = "transparent";
        }
        pub mod amber {
            pub const BG: &str = "#FEF3C7";
            pub const FG: &str = "#92400E";
            pub const BORDER: &str = "transparent";
        }
        pub mod lime {
            pub const BG: &str = "#ECFCCB";
            pub const FG: &str = "#3F6212";
            pub const BORDER: &str = "transparent";
        }
        pub mod green {
            pub const BG: &str = "#DCFCE7";
            pub const FG: &str = "#166534";
            pub const BORDER: &str = "transparent";
        }
        pub mod teal {
            pub const BG: &str = "#CCFBF1";
            pub const FG: &str = "#115E59";
            pub const BORDER: &str = "transparent";
        }
        pub mod cyan {
            pub const BG: &str = "#CFFAFE";
            pub const FG: &str = "#155E75";
            pub const BORDER: &str = "transparent";
        }
    }
}

/// Spacing scale in logical pixels.
pub mod spacing {
    pub const SPACE_0_5: u32 = 2;
    pub const SPACE_1: u32 = 4;
    pub const SPACE_2: u32 = 8;
    pub const SPACE_3: u32 = 12;
    pub const SPACE_4: u32 = 16;
    pub const SPACE_5: u32 = 20;
    pub const SPACE_6: u32 = 24;
    pub const SPACE_8: u32 = 32;
    pub const SPACE_10: u32 = 40;
    pub const SPACE_12: u32 = 48;
    pub const SPACE_16: u32 = 64;
}

/// Corner radii in logical pixels (`PILL` is effectively fully rounded).
pub mod radii {
    pub const CONTROL: u32 = 6;
    pub const BOX: u32 = 8;
    pub const POPOVER: u32 = 12;
    pub const PILL: u32 = 999;
}

/// Type sizes in logical pixels.
pub mod font_size {
    pub const CAPTION: u32 = 11;
    pub const BODY_SM: u32 = 12;
    pub const BODY: u32 = 13;
    pub const TITLE_SM: u32 = 14;
    pub const TITLE: u32 = 16;
    pub const VIEW_TITLE: u32 = 20;
    pub const DRILL_HEADER: u32 = 24;
}

/// Type weights (CSS numeric weights).
pub mod font_weight {
    pub const CAPTION_WEIGHT: u32 = 500;
    pub const BODY_SM_WEIGHT: u32 = 400;
    pub const BODY_WEIGHT: u32 = 400;
    pub const TITLE_SM_WEIGHT: u32 = 600;
    pub const TITLE_WEIGHT: u32 = 650;
    pub const VIEW_TITLE_WEIGHT: u32 = 650;
    pub const DRILL_HEADER_WEIGHT: u32 = 700;
}
