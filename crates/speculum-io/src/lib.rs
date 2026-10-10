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
}
