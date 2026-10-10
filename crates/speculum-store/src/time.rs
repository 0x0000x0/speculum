//! Millisecond-clock helpers: UTC formatting and ISO weeks without chrono.

/// Current unix time in milliseconds.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// Days since 1970-01-01 -> (year, month, day).
pub fn days_to_ymd(mut days: i64) -> (i64, u32, u32) {
    let mut year: i64 = 1970;
    if days >= 0 {
        loop {
            let dy = if is_leap(year) { 366 } else { 365 };
            if days < dy {
                break;
            }
            days -= dy;
            year += 1;
        }
    } else {
        loop {
            year -= 1;
            let dy = if is_leap(year) { 366 } else { 365 };
            days += dy;
            if days >= 0 {
                break;
            }
        }
    }
    let mut month: u32 = 1;
    loop {
        let dim = days_in_month(year, month) as i64;
        if days < dim {
            break;
        }
        days -= dim;
        month += 1;
    }
    (year, month, (days + 1) as u32)
}

/// Split `now_ms` into UTC calendar parts + millis.
pub fn split_ms(now_ms: u64) -> (i64, u32, u32, u32, u32, u32, u32) {
    let secs = (now_ms / 1000) as i64;
    let millis = (now_ms % 1000) as u32;
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400) as u32;
    let (y, mo, d) = days_to_ymd(days);
    let hh = sod / 3600;
    let mm = (sod % 3600) / 60;
    let ss = sod % 60;
    (y, mo, d, hh, mm, ss, millis)
}

/// `YYYYMMDD-HHMMSS-mmm` in UTC for snapshot filenames.
pub fn snapshot_stamp(now_ms: u64) -> String {
    let (y, mo, d, hh, mm, ss, millis) = split_ms(now_ms);
    format!("{y:04}{mo:02}{d:02}-{hh:02}{mm:02}{ss:02}-{millis:03}")
}

/// `YYYY-MM-DD` in UTC for auto-version names.
pub fn date_str(now_ms: u64) -> String {
    let secs = (now_ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let (y, mo, d) = days_to_ymd(days);
    format!("{y:04}-{mo:02}-{d:02}")
}

/// Weekday, Monday = 0 .. Sunday = 6. 1970-01-01 was a Thursday (3).
pub fn weekday_mon0(now_ms: u64) -> u32 {
    let secs = (now_ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    ((days + 3).rem_euclid(7)) as u32
}

/// Ordinal day of year (1-based).
fn ordinal(y: i64, m: u32, d: u32) -> u32 {
    let mut n = 0u32;
    let mut mo = 1u32;
    while mo < m {
        n += days_in_month(y, mo);
        mo += 1;
    }
    n + d
}

fn weekday_mon1(y: i64, m: u32, d: u32) -> u32 {
    // Days since epoch for ymd.
    let mut days: i64 = 0;
    if y >= 1970 {
        let mut yy = 1970i64;
        while yy < y {
            days += if is_leap(yy) { 366 } else { 365 };
            yy += 1;
        }
    } else {
        let mut yy = y;
        while yy < 1970 {
            days -= if is_leap(yy) { 366 } else { 365 };
            yy += 1;
        }
    }
    let mut mo = 1u32;
    while mo < m {
        days += days_in_month(y, mo) as i64;
        mo += 1;
    }
    days += (d as i64) - 1;
    ((days + 3).rem_euclid(7) + 1) as u32 // Mon=1..Sun=7
}

/// ISO-8601 week key `YYYY-Www` for `now_ms`.
pub fn iso_week_key(now_ms: u64) -> String {
    let secs = (now_ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let (y, m, d) = days_to_ymd(days);
    let wd = weekday_mon1(y, m, d) as i64; // Mon=1
    // Thursday of this week decides the ISO year.
    let thursday_offset = 4 - wd;
    let td = days + thursday_offset;
    // Ordinal of that Thursday within its year.
    let (ty, tm, tday) = days_to_ymd(td);
    let iso_year = ty;
    let ord = ordinal(ty, tm, tday) as i64;
    let week = ((ord - 1) / 7 + 1) as u32;
    format!("{iso_year:04}-W{week:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_formats() {
        assert_eq!(snapshot_stamp(0), "19700101-000000-000");
        assert_eq!(date_str(0), "1970-01-01");
        assert_eq!(weekday_mon0(0), 3); // Thursday
    }

    #[test]
    fn iso_week_known_dates() {
        // 2026-01-01 is a Thursday -> 2026-W01.
        // Days: compute via round trip sanity.
        let key = iso_week_key(1_767_225_600_000); // 2026-01-01T00:00:00Z
        assert_eq!(key, "2026-W01");
    }
}
