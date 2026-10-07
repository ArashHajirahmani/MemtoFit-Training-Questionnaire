#!/usr/bin/env python3
"""Fill plan-template.html from a GymPlan and its Notes companion."""

import argparse
import base64
import hashlib
import html
import os
import re
from pathlib import Path
from urllib.parse import quote

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "plan-template.html"

MONTHS = {
    "jan": "January", "feb": "February", "mar": "March", "apr": "April",
    "may": "May", "jun": "June", "jul": "July", "aug": "August",
    "sep": "September", "oct": "October", "nov": "November", "dec": "December",
}
SHORT_DAY = {
    "Monday": "Mon", "Tuesday": "Tue", "Wednesday": "Wed", "Thursday": "Thu",
    "Friday": "Fri", "Saturday": "Sat", "Sunday": "Sun",
}
WEEKDAYS = "|".join(SHORT_DAY)
ROMAN = {"Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5, "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}
LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
MARK = re.compile(r"\*\(([^)]*)\)\*")
DAY_HEAD = re.compile(rf"^## Week .+ \((?P<day>{WEEKDAYS})\)\s*$")
PROGRAM_SECTIONS = (
    "Why this plan works",
    "How to read the gym file",
    "How to use a session",
    "How to run the cycle",
    "What is not in this plan",
    "After 3–4 weeks",
)


def plain_inline(text):
    text = LINK.sub(r"\1", text or "")
    text = text.replace("**", "").replace("`", "")
    text = text.replace("*", "")
    return re.sub(r"\s+", " ", text).strip()


def cells(line):
    return [part.strip() for part in line.strip().strip("|").split("|")]


def is_rule(row):
    return bool(row) and all(re.fullmatch(r":?-{3,}:?", part or "---") or part == "" for part in row)


def plain_block(text):
    out = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            row = cells(stripped)
            if is_rule(row):
                continue
            if row and plain_inline(row[0]).lower() in ("written", "exercise", "group", "column"):
                continue
            left = plain_inline(row[0]) if row else ""
            right = plain_inline(row[1]) if len(row) > 1 else ""
            if left and right:
                out.append(f"{left} — {right}")
            elif left:
                out.append(left)
            continue
        if stripped.startswith("### "):
            out.append("")
            out.append(plain_inline(stripped[4:]))
            continue
        if stripped.startswith("- "):
            out.append("• " + plain_inline(stripped[2:]))
            continue
        numbered = re.match(r"^(\d+)\. (.*)", stripped)
        if numbered:
            out.append(numbered.group(1) + ". " + plain_inline(numbered.group(2)))
            continue
        out.append(plain_inline(line) if stripped else "")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def sections(text):
    found = {}
    parts = re.split(r"(?m)^## ", text)
    for part in parts[1:]:
        title, _, body = part.partition("\n")
        found[title.strip()] = body.strip()
    return found


def day_number(title):
    match = re.match(r"Day (\d+)\b", title.strip())
    return int(match.group(1)) if match else None


def briefs_from(body):
    briefs = {}
    for chunk in re.split(r"(?m)^### ", body or ""):
        match = re.match(r"(Day \d+[^\n]*)\n(.*)", chunk, re.S)
        if not match:
            continue
        number = day_number(match.group(1))
        if number:
            briefs[number] = plain_block(match.group(2))
    return briefs


def exercise_rows(body):
    """Map day number → list of {names, description, watch} from ### Day N tables."""
    tables = {}
    chunks = re.split(r"(?m)^### ", body or "")
    for chunk in chunks[1:] if chunks else []:
        title, _, rest = chunk.partition("\n")
        number = day_number(title)
        if not number:
            continue
        lines = [line for line in rest.splitlines() if line.strip().startswith("|")]
        # Stop at the first non-table content after the table has started,
        # but the split already ends at the next heading.
        parsed = []
        header = None
        for line in lines:
            row = cells(line)
            if is_rule(row):
                continue
            if header is None:
                header = [plain_inline(part).lower() for part in row]
                continue
            if not header or "exercise" not in header[0]:
                continue
            names = LINK.findall(row[0] if row else "")
            if not names:
                continue
            description = row[1] if len(row) > 1 else ""
            watch = row[2] if len(row) > 2 else ""
            parsed.append({
                "names": names,
                "description": description,
                "watch": watch,
            })
        if parsed:
            tables[number] = parsed
    return tables


def program_note(found):
    chunks = []
    for title in PROGRAM_SECTIONS:
        body = found.get(title, "").strip()
        if body:
            chunks.append(title + "\n\n" + plain_block(body))
    return "\n\n".join(chunks).strip()


def day_section(found):
    for title, body in found.items():
        if re.fullmatch(r"The .+ days", title):
            return body
    return ""


def block_text(row, show_name):
    parts = []
    if show_name:
        parts.append(" / ".join(row["names"]))
    description = plain_inline(row["description"])
    watch = plain_inline(row["watch"])
    if description:
        parts.append(description)
    if watch:
        if parts:
            parts.append("")
        parts.append("Watch")
        parts.append(watch)
    return "\n".join(parts).strip()


def popup_for(day_no, names, tables):
    rows = tables.get(day_no, [])
    picked = []
    used = set()
    for name in names:
        for index, row in enumerate(rows):
            if index in used:
                continue
            if name.lower() in {item.lower() for item in row["names"]}:
                used.add(index)
                picked.append(row)
                break
    if not picked:
        return ""
    texts = []
    several = len(picked) > 1
    for row in picked:
        texts.append(block_text(row, several or len(row["names"]) > 1))
    return "\n\n".join(text for text in texts if text)


def info_button(text, label, on_dark=False):
    if not text.strip():
        return ""
    klass = "info on-dark" if on_dark else "info"
    return (
        f'<button type="button" class="{klass}" aria-label="{html.escape(label)}" aria-expanded="false">'
        '<span aria-hidden="true">i</span></button>'
        f'<span class="note-src" hidden>{html.escape(text)}</span>'
    )


def yt(name):
    phrase = quote(f'"{name}"', safe="").replace("%20", "+")
    return "https://www.google.com/search?q=" + phrase + "+site%3Ayoutube.com&udm=7&tbs=dur%3As"


def link(name):
    href = html.escape(yt(name), quote=True)
    return f'<a href="{href}" target="_blank" rel="noopener noreferrer">{html.escape(name)}</a>'


def slug(names):
    parts = []
    for name in names:
        piece = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if piece:
            parts.append(piece)
    return "+".join(parts)


def display_hint(text):
    key = text.strip().lower()
    if key == "start here":
        return "Start here"
    if key == "always last":
        return "Always last"
    return text.strip()


def parse_exercise_cell(cell):
    hints = []
    ss = None
    for mark in MARK.findall(cell):
        token = mark.strip()
        if "SS" in token and "↓" in token:
            ss = "down"
        elif "SS" in token and "↑" in token:
            ss = "up"
        elif token:
            hints.append(display_hint(token))
    groups = []
    for chunk in re.split(r"\*\*OR\*\*", MARK.sub(" ", cell)):
        names = LINK.findall(chunk)
        if names:
            groups.append(names)
    return groups, hints, ss


def fmt_sets(text):
    text = MARK.sub("", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\b[xX]\b", "×", text)
    text = re.sub(r"(?<=\d)-(?=\d)", "–", text)
    return text


def hint_html(hints):
    return "".join(f'<small class="hint">{html.escape(hint)}</small>' for hint in hints if hint)


def exercise_html(groups, join_word, note):
    parts = []
    flat = []
    for index, group in enumerate(groups):
        if index:
            parts.append(f'<b class="join">{join_word}</b>')
        for inner, name in enumerate(group):
            if inner:
                parts.append('<b class="join">OR</b>')
            parts.append(link(name))
            flat.append(name)
    label = "Note for " + " and ".join(flat[:3])
    parts.append(info_button(note, label))
    return '<span class="exercise">' + "".join(parts) + "</span>", flat


def row_html(groups, join_word, hints, sets, note, key, pair=False):
    exercise, _names = exercise_html(groups, join_word, note)
    klass = ' class="pair"' if pair else ""
    load = (
        f'<input class="load" data-key="{html.escape(key)}" hidden '
        'placeholder="lb" inputmode="decimal" enterkeyhint="done" '
        'autocomplete="off" autocapitalize="off" spellcheck="false" '
        'aria-label="Weight">'
    )
    return (
        f"<tr{klass}><th>{exercise}{hint_html(hints)}</th>"
        f'<td class="sets">{html.escape(sets)}{load}</td></tr>'
    )


MONTH_NUM = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def month_name(token):
    return MONTHS.get(token[:3].lower(), token)


def iso_date(line):
    match = re.search(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        r"\s+(\d{1,2}),?\s+(20\d{2})",
        line or "",
        re.I,
    )
    if not match:
        return ""
    month = MONTH_NUM.get(match.group(1)[:3].lower())
    if not month:
        return ""
    return f"{int(match.group(3)):04d}-{month:02d}-{int(match.group(2)):02d}"


def week_total(line):
    match = re.search(r"\b(\d+)\s+weeks\b", line or "", re.I)
    return match.group(1) if match else ""


def find_month(line):
    match = re.search(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b",
        line,
        re.I,
    )
    return match.group(1) if match else ""


def week_number(line):
    match = re.search(r"WEEK\s+([ⅠⅡⅢⅣⅤ]+|IV|III|II|I|V|\d+)", line)
    if not match:
        return None
    token = match.group(1)
    if token.isdigit():
        return int(token)
    return ROMAN.get(token)


def parse_gym(text):
    goal = ""
    start = finish = ""
    weeks = []
    current = None
    day = None
    expect_goal = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("**Start:**"):
            start = line
            continue
        if line.startswith("**Finish:**"):
            finish = line
            continue
        if line.startswith("**Goal:**") and not weeks and current is None:
            goal = line.split(":", 1)[1].strip().lstrip("*").strip()
            continue
        number = week_number(line) if line.startswith("WEEK") or line.startswith("**WEEK") else None
        if number and not line.startswith("##"):
            current = {"n": number, "days": []}
            weeks.append(current)
            day = None
            expect_goal = False
            continue
        head = DAY_HEAD.match(line)
        if head and current is not None:
            day = {"weekday": head.group("day"), "focus": "", "rows": []}
            current["days"].append(day)
            expect_goal = False
            continue
        if day is None:
            continue
        if line.startswith("**Goal"):
            if ":" in line and line.split(":", 1)[1].strip():
                day["focus"] = line.split(":", 1)[1].strip()
                expect_goal = False
            else:
                expect_goal = True
            continue
        if expect_goal and line and not line.startswith("|"):
            day["focus"] = line
            expect_goal = False
            continue
        if line.startswith("|") and not is_rule(cells(line)):
            row = cells(line)
            if row and plain_inline(row[0]).lower() == "exercise":
                continue
            if len(row) >= 2 and LINK.search(row[0]):
                groups, hints, ss = parse_exercise_cell(row[0])
                day["rows"].append({
                    "groups": groups,
                    "hints": hints,
                    "ss": ss,
                    "sets": fmt_sets(row[1]),
                })
    return {
        "goal": goal,
        "start": start,
        "finish": finish,
        "weeks": [week for week in weeks if week["days"]],
    }


def pair_sets(left, right):
    if left == right:
        return f"{left} each"
    return f"{left} · {right}"


def render_rows(day_no, rows, tables):
    html_rows = []
    index = 0
    while index < len(rows):
        row = rows[index]
        nxt = rows[index + 1] if index + 1 < len(rows) else None
        if row["ss"] == "down" and nxt and nxt["ss"] == "up":
            groups = row["groups"] + nxt["groups"]
            names = [name for group in groups for name in group]
            hints = ["Superset · do both"] + [hint for hint in row["hints"] + nxt["hints"] if hint]
            html_rows.append(row_html(
                groups, "AND", hints, pair_sets(row["sets"], nxt["sets"]),
                popup_for(day_no, names, tables), f"{day_no - 1}:{slug(names)}", pair=True,
            ))
            index += 2
            continue
        names = [name for group in row["groups"] for name in group]
        html_rows.append(row_html(
            row["groups"], "OR", row["hints"], row["sets"],
            popup_for(day_no, names, tables), f"{day_no - 1}:{slug(names)}",
        ))
        index += 1
    return "\n".join(html_rows)


def focus_text(text):
    return html.escape(text.replace("•", "·").replace(" · ", " · "))


def render(plan, notes, person, slot):
    found = sections(notes)
    tables = exercise_rows(found.get("Exercise notes", ""))
    briefs = briefs_from(day_section(found))
    title_note = program_note(found)
    weeks = plan["weeks"]
    if not weeks:
        raise SystemExit("No weeks found in the gym file.")
    day_count = len(weeks[0]["days"])
    if any(len(week["days"]) != day_count for week in weeks):
        raise SystemExit("Each week needs the same number of days.")

    start_m = find_month(plan["start"])
    finish_m = find_month(plan["finish"]) or start_m
    year_match = re.search(r"(20\d{2})", plan["finish"] or plan["start"])
    year = year_match.group(1) if year_match else ""
    nice = person[:1].upper() + person[1:]
    apos = "\u2019"
    period = f"{month_name(start_m)} — {month_name(finish_m)} {year}".strip()
    title = f"MemtoFit · {nice}{apos}s Gym Plan · {start_m[:3].title()}–{finish_m[:3].title()} {year}".strip()
    goal = plan["goal"].replace("•", "·")

    h1 = html.escape(f"{nice}{apos}s Gym") + info_button(title_note, "About this program", on_dark=True)
    week_buttons = []
    for index, week in enumerate(weeks):
        selected = "true" if index == 0 else "false"
        week_buttons.append(
            f'<button type="button" role="tab" id="week-tab-{index + 1}" '
            f'aria-controls="week-panel-{index + 1}" aria-selected="{selected}" '
            f'data-week="{index}">Week {week["n"]}</button>'
        )
    day_buttons = []
    for index, day in enumerate(weeks[0]["days"]):
        selected = "true" if index == 0 else "false"
        day_buttons.append(
            f'<button type="button" role="tab" id="day-tab-{index + 1}" aria-selected="{selected}" '
            f'data-day="{index}"><small>DAY {index + 1}</small>{SHORT_DAY[day["weekday"]]}</button>'
        )

    panels = []
    missing = []
    for w_index, week in enumerate(weeks):
        hidden = "" if w_index == 0 else " hidden"
        parts = [
            f'<div id="week-panel-{w_index + 1}" role="tabpanel" aria-labelledby="week-tab-{w_index + 1}"{hidden}>'
        ]
        for d_index, day in enumerate(week["days"]):
            day_no = d_index + 1
            section_hidden = "" if w_index == 0 and d_index == 0 else " hidden"
            if len(weeks) == 1:
                eyebrow = f"DAY {day_no}"
            else:
                eyebrow = f"WEEK {week['n']} · DAY {day_no}"
            brief = briefs.get(day_no, "")
            heading = html.escape(day["weekday"])
            if brief:
                heading = (
                    f'<span>{heading}</span>'
                    + info_button(brief, f"Note for {day['weekday']}")
                )
                h2 = f'<h2 class="noted">{heading}</h2>'
            else:
                h2 = f"<h2>{heading}</h2>"
            body = render_rows(day_no, day["rows"], tables)
            if w_index == 0:
                for row in day["rows"]:
                    names = [name for group in row["groups"] for name in group]
                    if names and not popup_for(day_no, names, tables):
                        missing.append(f"Day {day_no}: {', '.join(names)}")
            note_box = (
                f'<label class="day-note-wrap"><span>Note</span>'
                f'<textarea class="day-note" data-day="{w_index}-{d_index}" '
                f'placeholder="Note for this day"></textarea></label>'
            )
            parts.append(
                f'<section class="panel" data-panel="{w_index}-{d_index}" role="tabpanel" '
                f'aria-labelledby="day-tab-{d_index + 1}"{section_hidden}>'
                f'<p class="eyebrow">{eyebrow}</p>{h2}'
                f'<p class="focus">{focus_text(day["focus"])}</p>'
                f'<div class="table-wrap"><table><thead><tr>'
                f"<th>Exercise</th><th>Sets &amp; reps</th></tr></thead><tbody>\n"
                f"{body}\n</tbody></table></div>{note_box}</section>"
            )
        parts.append("</div>")
        panels.append("".join(parts))

    page = TEMPLATE.read_text()
    replacements = {
        "{{TITLE}}": html.escape(title),
        "{{DESCRIPTION}}": html.escape(f"{nice}{apos}s personalized gym plan."),
        "{{H1_HTML}}": h1,
        "{{PERIOD}}": html.escape(period),
        "{{START_DATE}}": html.escape(iso_date(plan["start"])),
        "{{WEEK_TOTAL}}": html.escape(week_total(plan["finish"])),
        "{{GOAL}}": html.escape(goal),
        "{{STORAGE_KEY}}": html.escape(f"memtofit-done-{slot}"),
        "{{WEEK_BUTTONS}}": "\n    ".join(week_buttons),
        "{{DAY_BUTTONS}}": "\n    ".join(day_buttons),
        "{{PANELS}}": "\n  ".join(panels),
    }
    for token, value in replacements.items():
        if token not in page:
            raise SystemExit(f"Missing {token} in the template.")
        page = page.replace(token, value)
    if "{{" in page:
        raise SystemExit("Unresolved template placeholder.")
    return page, missing


def encrypt_plan(password, page):
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000, dklen=32)
    cipher = AESGCM(key).encrypt(iv, page.encode(), None)
    return base64.b64encode(salt + iv + cipher).decode()


def normalize_name(name):
    return re.sub(r"\s+", "", name.strip().lower())


def main():
    parser = argparse.ArgumentParser(description="Build a MemtoFit program page from the gym and notes files.")
    parser.add_argument("gym", type=Path)
    parser.add_argument("--notes", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--slot", required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--encrypt-out", type=Path)
    args = parser.parse_args()
    notes = args.notes
    if notes is None:
        notes = Path(str(args.gym).replace("GymPlan", "Notes"))
    page, missing = render(
        parse_gym(args.gym.read_text()),
        notes.read_text(),
        args.name.strip(),
        args.slot.strip(),
    )
    if args.out:
        args.out.write_text(page)
    if args.encrypt_out:
        args.encrypt_out.write_text(encrypt_plan(normalize_name(args.name), page))
    print(f"weeks={page.count('data-week=')} days={page.count('data-day=')} info={page.count('class=\"info')} missing={len(missing)}")
    for item in missing:
        print("missing", item)


if __name__ == "__main__":
    main()
