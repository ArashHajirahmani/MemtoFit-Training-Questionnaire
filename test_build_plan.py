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

    def test_at_most_three_prompts_across_both_weeks(self):
        body = "| Week | Day | Feedback prompt |\n|---|---|---|\n| 1 | 1 | Setup comfort: |\n| 1 | 2 | Hip response: |\n| 2 | 3 | Skipped at cap: |"
        prompts = b.feedback_prompts(body, plan()["weeks"])
        self.assertEqual(len(prompts), 3)
        self.assertEqual(prompts["1-2"], "Skipped at cap:")
        with self.assertRaises(SystemExit):
            b.feedback_prompts(body + "\n| 2 | 1 | Fourth: |", plan()["weeks"])

    def test_invalid_feedback_targets_and_length(self):
        for body in ("| 3 | 1 | Missing week: |", "| 1 | 4 | Missing day: |", "| 1 | 1 | |", "| 1 | 1 | First: |\n| 1 | 1 | Duplicate: |", "| 1 | 1 | " + "x" * 121 + " |"):
            with self.subTest(body=body), self.assertRaises(SystemExit):
                b.feedback_prompts(body, plan()["weeks"])

    def test_render_progress_and_feedback_defaults(self):
        page, _ = b.render(plan(), "## Critical feedback\n| Week | Day | Feedback prompt |\n|---|---|---|\n| 1 | 2 | Setup <comfort>: |", "Test", "test-slot")
        self.assertIn('data-start="2026-10-26" data-weeks="12"', page)
        self.assertEqual(page.count('>Setup &lt;comfort&gt;:</textarea>'), 1)
        self.assertIn('data-day="0-1" placeholder="Note for this day">Setup &lt;comfort&gt;:', page)

    def test_superset_contract(self):
        self.assertEqual(b.superset_self_test(), [])


if __name__ == "__main__":
    unittest.main()
