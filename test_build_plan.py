"""Publisher regressions; no remote writes or personal data required."""
import unittest
from urllib.parse import parse_qs, urlparse

import build_plan as b


def plan(finish="January 18, 2027"):
    text = "# 12 Week Program\n**Start:** October 26, 2026\n**Finish:** " + finish + "\n"
    for week in ("Ⅰ", "Ⅱ"):
        text += f"\nWEEK {week}\n"
        for day, weekday in enumerate(("Monday", "Wednesday", "Saturday"), 1):
            text += f"\n## Week {week} - Day {day} ({weekday})\n| Exercise | Sets |\n|---|---|\n| [Plank](https://example.com) | 3 x 30 sec |\n"
    return b.parse_gym(text)


class PublisherTests(unittest.TestCase):
    def test_duration_from_review_boundary_without_parenthetical(self):
        self.assertEqual(b.cycle_metadata(plan()), ("2026-10-26", "12"))
        self.assertEqual(b.cycle_metadata(plan("January 18, 2027 (12 Weeks)"))[1], "12")

    def test_invalid_or_conflicting_dates_fail(self):
        for finish in ("missing", "February 30, 2027", "October 26, 2026", "October 19, 2026", "January 18, 2027 (13 Weeks)"):
            with self.subTest(finish=finish), self.assertRaises(SystemExit):
                b.cycle_metadata(plan(finish))

    def test_leap_year_and_partial_final_week(self):
        self.assertEqual(b.cycle_metadata({"start": "February 26, 2028", "finish": "March 11, 2028"})[1], "2")
        self.assertEqual(b.cycle_metadata(plan("January 19, 2027"))[1], "13")

    def test_instructional_video_query(self):
        for name in ("Step-Up", "Ab Crunch Machine", "Smith Machine Squat"):
            query = parse_qs(urlparse(b.yt(name)).query)
            self.assertEqual(query["q"], [f'how to do "{name}" exercise site:youtube.com'])
            self.assertEqual(query["udm"], ["7"])
            self.assertEqual(query["tbs"], ["dur:s"])

    def test_render_keeps_all_note_defaults_empty(self):
        # A stale source section must never reintroduce anticipated symptom prompts.
        page, _ = b.render(plan(), "## Critical feedback\n| Week | Day | Feedback prompt |\n|---|---|---|\n| 1 | 2 | Setup comfort: |", "Test", "test-slot", "2026-10-13")
        self.assertIn('data-start="2026-10-26" data-weeks="12"', page)
        import re
        fields = re.findall(r'<textarea\b[^>]*>(.*?)</textarea>', page, re.S)
        self.assertEqual(len(fields), 6)
        self.assertTrue(all(value == "" for value in fields))
        self.assertNotIn('Setup comfort:', page)

    def test_footer_preserves_recorded_issue_date(self):
        page, _ = b.render(plan(), "", "Test", "test-slot", "2026-10-13")
        self.assertIn('Issued on <time datetime="2026-10-13">Oct 13, 2026</time>', page)
        self.assertNotIn('v2.1', page)
        self.assertNotIn('{{', page)

    def test_issue_date_requires_calendar_date_without_time(self):
        for value in (None, "", "20261013", "2026-02-30", "2026-10-13T12:00:00Z"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                b.issue_date(value)
        self.assertEqual(b.issue_date("2028-02-29").isoformat(), "2028-02-29")

    def test_superset_contract(self):
        self.assertEqual(b.superset_self_test(), [])


if __name__ == "__main__":
    unittest.main()
