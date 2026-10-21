#!/usr/bin/env python3
"""Fill plan-template.html from a GymPlan and its Notes companion."""

import argparse
import base64
import hashlib
import html
import os
import re
import sys
from datetime import date
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


INLINE = re.compile(r"(\*\*[^*]+?\*\*|`[^`]+`)")


def inline_html(text):
    text = LINK.sub(r"\1", text or "")
    out = []
    pos = 0
    for match in INLINE.finditer(text):
        out.append(html.escape(text[pos:match.start()]).replace("*", ""))
        token = match.group(0)
        inner = token[1:-1] if token.startswith("`") else token[2:-2]
        out.append("<b>" + html.escape(inner) + "</b>")
        pos = match.end()
    out.append(html.escape(text[pos:]).replace("*", ""))
    return "".join(out)


def table_html(rows):
    parts = ["<table><thead><tr>"]
    for cell in rows[0]:
        parts.append("<th>" + inline_html(cell) + "</th>")
    parts.append("</tr></thead><tbody>")
    for row in rows[1:]:
        parts.append("<tr>")
        for index, cell in enumerate(row):
            tag = "th" if index == 0 else "td"
            parts.append(f"<{tag}>" + inline_html(cell) + f"</{tag}>")
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def note_html(text):
    """Safe HTML for an info popup. Tables stay tables."""
    blocks = []
    paragraph = []
    bullets = []
    numbers = []

    def flush_paragraph():
        if paragraph:
            blocks.append("<p>" + " ".join(paragraph) + "</p>")
            paragraph.clear()

    def flush_bullets():
        if bullets:
            blocks.append("<ul>" + "".join(f"<li>{item}</li>" for item in bullets) + "</ul>")
            bullets.clear()

    def flush_numbers():
        if numbers:
            blocks.append("<ol>" + "".join(f"<li>{item}</li>" for item in numbers) + "</ol>")
            numbers.clear()

    def flush_text():
        flush_paragraph()
        flush_bullets()
        flush_numbers()

    lines = (text or "").splitlines()
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if re.fullmatch(r"[-*_]{3,}", stripped):
            flush_text()
            index += 1
            continue
        if stripped.startswith("|"):
            flush_text()
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                row = cells(lines[index])
                if not is_rule(row):
                    rows.append(row)
                index += 1
            if rows:
                blocks.append(table_html(rows))
            continue
        if stripped.startswith("### "):
            flush_text()
            blocks.append("<h4>" + inline_html(stripped[4:]) + "</h4>")
        elif stripped.startswith("- "):
            flush_paragraph()
            flush_numbers()
            bullets.append(inline_html(stripped[2:]))
        elif re.match(r"^\d+\. ", stripped):
            flush_paragraph()
            flush_bullets()
            numbers.append(inline_html(re.sub(r"^\d+\. ", "", stripped)))
        elif stripped == "":
            flush_text()
        else:
            flush_bullets()
            flush_numbers()
            paragraph.append(inline_html(stripped))
        index += 1
    flush_text()
    return "".join(blocks)


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
            briefs[number] = note_html(match.group(2))
    return briefs


def named_brief(body, name):
    for chunk in re.split(r"(?m)^### ", body or ""):
        match = re.match(rf"({re.escape(name)}[^\n]*)\n(.*)", chunk, re.S)
        if not match:
            continue
        section = re.split(r"(?m)^## ", match.group(2), maxsplit=1)[0]
        section = re.sub(r"(?m)^---\s*$", "", section).strip()
        return note_html(section)
    return ""


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
            chunks.append("<h3>" + html.escape(title) + "</h3>" + note_html(body))
    return "\n\n".join(chunks).strip()


def day_section(found):
    for title, body in found.items():
        if re.fullmatch(r"The .+ days", title):
            return body
    return ""


def block_text(row, show_name):
    parts = []
    if show_name:
        parts.append("<p><b>" + html.escape(" / ".join(row["names"])) + "</b></p>")
    description = inline_html(row["description"])
    watch = inline_html(row["watch"])
    if description:
        parts.append("<p>" + description + "</p>")
    if watch:
        parts.append("<p><b>Watch</b> " + watch + "</p>")
    return "".join(parts)


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
        texts.append(block_text(row, several))
    return "\n\n".join(text for text in texts if text)


def info_button(text, label, on_dark=False):
    if not text.strip():
        return ""
    klass = "info on-dark" if on_dark else "info"
    return (
        f'<button type="button" class="{klass}" aria-label="{html.escape(label)}" aria-expanded="false">'
        '<span aria-hidden="true">i</span></button>'
        f'<span class="note-src" hidden>{text}</span>'
    )


def yt(name):
    phrase = quote(f'how to do "{name}" exercise', safe="").replace("%20", "+")
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
    unique = []
    for hint in hints:
        if hint and hint not in unique:
            unique.append(hint)
    return "".join(f'<small class="hint">{html.escape(hint)}</small>' for hint in unique)


def exercise_html(groups, join_word, note, group=""):
    parts = []
    flat = []
    if group:
        parts.append(f'<b class="join">{html.escape(group)}</b>')
    several = len(groups) > 1
    for index, names in enumerate(groups):
        if index:
            parts.append(f'<b class="join">{html.escape(join_word)}</b>')
        wrap = several and len(names) > 1
        chunk = []
        if wrap:
            chunk.append('<b class="join">(</b>')
        for inner, name in enumerate(names):
            if inner:
                chunk.append('<b class="join">OR</b>')
            chunk.append(link(name))
            flat.append(name)
        if wrap:
            chunk.append('<b class="join">)</b>')
            parts.append('<span class="side">' + "".join(chunk) + "</span>")
        else:
            parts.extend(chunk)
    if note:
        label = "Note for " + " and ".join(flat[:3])
        parts.append(info_button(note, label))
    return '<span class="exercise">' + "".join(parts) + "</span>", flat


def score_kind(sets):
    text = (sets or "").lower()
    if re.search(r"\bmin\b", text) and not re.search(r"\bsec\b", text):
        return "time", "min"
    if re.search(r"\bsec\b", text):
        return "time", "sec"
    return "load", "lb"


def row_html(groups, join_word, hints, sets, note, key, group="", track=True):
    exercise, _names = exercise_html(groups, join_word, note, group)
    load = ""
    if track:
        kind, unit = score_kind(sets)
        placeholder = {"min": "min", "sec": "sec"}.get(unit, "lb")
        label = "Time" if kind == "time" else "Weight"
        mode = "text" if kind == "time" else "decimal"
        load = (
            f'<input class="load" data-key="{html.escape(key)}" data-kind="{kind}" '
            f'data-unit="{unit}" hidden placeholder="{placeholder}" inputmode="{mode}" '
            'enterkeyhint="done" autocomplete="off" autocapitalize="off" spellcheck="false" '
            f'aria-label="{label}">'
        )
    return (
        f"<tr><th>{exercise}{hint_html(hints)}</th>"
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


def cycle_metadata(plan):
    """Finish is the exclusive review boundary, not an extra training week."""
    start, finish = iso_date(plan["start"]), iso_date(plan["finish"])
    try:
        days = (date.fromisoformat(finish) - date.fromisoformat(start)).days
    except ValueError:
        raise SystemExit("Program Start and Finish must contain valid dates with years.")
    if days <= 0:
        raise SystemExit("Program Finish must be after Start.")
    total = (days + 6) // 7
    stated = week_total(plan["finish"])
    if stated and int(stated) != total:
        raise SystemExit("Finish week count conflicts with the Start/Finish dates.")
    return start, str(total)


def feedback_prompts(body, weeks):
    """Optional, authored prompts: at most three across the entire program."""
    prompts = {}
    for line in (body or "").splitlines():
        if not line.strip().startswith("|"):
            continue
        row = cells(line)
        if is_rule(row) or row == ["Week", "Day", "Feedback prompt"]:
            continue
        if len(row) != 3 or not row[0].isdigit() or not row[1].isdigit():
            raise SystemExit("Critical feedback needs Week | Day | Feedback prompt rows.")
        week, day = int(row[0]) - 1, int(row[1]) - 1
        if not (0 <= week < len(weeks) and 0 <= day < len(weeks[week]["days"])):
            raise SystemExit("Critical feedback references a missing week/day.")
        key = f"{week}-{day}"
        prompt = row[2].strip()
        if key in prompts or not prompt or len(prompt) > 120:
            raise SystemExit("Use one short critical feedback prompt per chosen session (max 120 characters).")
        prompts[key] = prompt
    if len(prompts) > 3:
        raise SystemExit("Critical feedback is limited to three prompts per program, across all weeks.")
    return prompts


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


def bonus_banner(line):
    return "BONUS" in line.upper() and not line.startswith("|") and not line.startswith("#")


def bonus_heading(line):
    match = re.fullmatch(r"#{0,3}\s*(Support|Coverage|Cardio|Optional)", line, re.I)
    return match.group(1).lower() if match else ""


def bonus_prose(line):
    if not line or line.startswith("|") or line.startswith("#"):
        return False
    return not set(line) <= {"-", "="}


def take_row(row):
    if not row or plain_inline(row[0]).lower() in ("exercise", "group"):
        return None
    source = None
    sets = ""
    group = ""
    if len(row) >= 3 and LINK.search(row[1]) and not LINK.search(row[0]):
        source = row[1]
        sets = row[2]
        group = plain_inline(row[0])
    elif len(row) >= 2 and LINK.search(row[0]):
        source = row[0]
        sets = row[1]
    if not source:
        return None
    groups, hints, ss = parse_exercise_cell(source)
    if not groups:
        return None
    return {
        "group": group,
        "groups": groups,
        "hints": hints,
        "ss": ss,
        "sets": fmt_sets(sets),
    }


def parse_gym(text):
    goal = ""
    start = finish = ""
    weeks = []
    bonus_rows = {name: [] for name in ("bonus", "support", "coverage", "cardio", "optional")}
    bonus_leads = {name: "" for name in bonus_rows}
    current = None
    day = None
    mode = ""
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
            mode = ""
            expect_goal = False
            continue
        head = DAY_HEAD.match(line)
        if head and current is not None:
            day = {"weekday": head.group("day"), "focus": "", "rows": []}
            current["days"].append(day)
            mode = ""
            expect_goal = False
            continue
        if bonus_banner(line):
            day = None
            mode = "bonus"
            expect_goal = False
            continue
        section = bonus_heading(line)
        if section:
            day = None
            mode = section
            expect_goal = False
            continue
        if mode == "bonus" and line.lower().startswith("choose"):
            bonus_leads["bonus"] = plain_inline(line)
            continue
        if mode in ("support", "coverage", "cardio") and bonus_prose(line):
            text = plain_inline(line)
            bonus_leads[mode] = f"{bonus_leads[mode]} {text}".strip()
            continue
        if line.startswith("|") and not is_rule(cells(line)):
            taken = take_row(cells(line))
            if not taken:
                continue
            if mode in bonus_rows:
                bonus_rows[mode].append(taken)
            elif day is not None:
                day["rows"].append({
                    "groups": taken["groups"],
                    "hints": taken["hints"],
                    "ss": taken["ss"],
                    "sets": taken["sets"],
                })
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
    return {
        "goal": goal,
        "start": start,
        "finish": finish,
        "weeks": [week for week in weeks if week["days"]],
        "bonus": bonus_rows["bonus"],
        "optional": bonus_rows["optional"],
        "bonus_lead": bonus_leads["bonus"],
        "support": bonus_rows["support"],
        "support_lead": bonus_leads["support"],
        "coverage": bonus_rows["coverage"],
        "coverage_lead": bonus_leads["coverage"],
        "cardio": bonus_rows["cardio"],
        "cardio_lead": bonus_leads["cardio"],
    }


def set_count(text):
    head = (text or "").split("(", 1)[0].strip()
    matched = re.match(r"(\d+)\s*[xX×]", head)
    if matched:
        return int(matched.group(1))
    if re.fullmatch(r"\d+(?:\s*[–\-]\s*\d+)+", head):
        return len(re.findall(r"\d+", head))
    return None


PLANNER = ROOT.parent
VETO_CUE = re.compile(r"never superset|pairing dropped|do not pair|superset veto", re.I)
TWO_MACHINE_VETO = re.compile(
    r"two[- ]machine supersets.{0,80}\boff\b|two machines are never a pair|do not program two-machine supersets",
    re.I | re.S,
)


def exercise_key(name):
    return re.sub(r"\s+", " ", re.sub(r"\bDB\b", "Dumbbell", name, flags=re.I)).strip().casefold()


def station_unit(station):
    station = (station or "").strip().strip("`")
    if station.startswith("Cable —"):
        return "cable"
    return station


def load_stations():
    stations = {}
    for path in sorted((PLANNER / "knowledge/exercises").glob("*.md")):
        header = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.startswith("|"):
                header = []
                continue
            row = cells(line)
            if row and row[0] == "Exercise":
                header = row
                continue
            if "Station" not in header or not row or row[0].startswith("---"):
                continue
            if len(row) != len(header):
                continue
            data = dict(zip(header, row))
            stations[exercise_key(row[0])] = data["Station"].strip().strip("`")
    return stations


def load_whitelist():
    text = (PLANNER / "knowledge/principles/supersets.md").read_text(encoding="utf-8")
    rows = []
    in_table = False
    for line in text.splitlines():
        if line.startswith("## ") and "Whitelist" in line:
            in_table = True
            continue
        if in_table and line.startswith("## "):
            break
        if not in_table or "↔" not in line:
            continue
        pair = cells(line)[0].replace("**", "")
        left, right = pair.split("↔", 1)

        def variants(side):
            return {exercise_key(part) for part in re.split(r"\bor\b", side) if part.strip()}

        rows.append((variants(left), variants(right)))
    if len(rows) < 3:
        raise SystemExit("Superset whitelist did not parse.")
    return rows


def names_in(text, stations):
    folded = exercise_key(text.replace("*", ""))
    found = []
    for name in sorted(stations, key=len, reverse=True):
        if name in folded:
            found.append(name)
            folded = folded.replace(name, " ")
    return found


def learned_superset_vetoes(text, stations):
    ban_two_machine = bool(TWO_MACHINE_VETO.search(text or ""))
    vetoes = set()
    for line in (text or "").splitlines():
        if not VETO_CUE.search(line.replace("*", "")):
            continue
        found = names_in(line, stations)
        for index, left in enumerate(found):
            for right in found[index + 1:]:
                vetoes.add(frozenset((left, right)))
    return ban_two_machine, vetoes


def row_names(row):
    return [name for group in row.get("groups", []) for name in group]


def side_names(row):
    names = []
    for name in row_names(row):
        if name not in names:
            names.append(name)
    return names


def same_whitelist_row(left_names, right_names, whitelist):
    for allowed_left, allowed_right in whitelist:
        if all(name in allowed_left for name in left_names) and all(name in allowed_right for name in right_names):
            return True
        if all(name in allowed_right for name in left_names) and all(name in allowed_left for name in right_names):
            return True
    return False


ACTIVE_SUPERSETS = None


def check_supersets(rows, where, stations=None, whitelist=None, vetoes=None, ban_two_machine=None):
    active = ACTIVE_SUPERSETS
    if stations is None:
        stations = active[0] if active else load_stations()
    if whitelist is None:
        whitelist = active[1] if active else load_whitelist()
    if vetoes is None:
        vetoes = active[2] if active else set()
    if ban_two_machine is None:
        ban_two_machine = active[3] if active else False
    pairs = 0
    index = 0
    while index < len(rows):
        row = rows[index]
        marker = row.get("ss")
        if marker == "up":
            raise SystemExit(f"{where}: superset end marker without a start.")
        if marker == "down":
            nxt = rows[index + 1] if index + 1 < len(rows) else None
            if not nxt or nxt.get("ss") != "up":
                raise SystemExit(f"{where}: superset start marker has no matching end.")
            left = set_count(row.get("sets", ""))
            right = set_count(nxt.get("sets", ""))
            if left is None or right is None or left != right:
                raise SystemExit(
                    f"{where}: superset set counts must be equal "
                    f"({row.get('sets')} vs {nxt.get('sets')})."
                )
            sides = [row_names(row), row_names(nxt)]
            if not sides[0] or not sides[1]:
                raise SystemExit(f"{where}: superset row has no exercise.")
            keyed = []
            units = []
            for side in sides:
                side_keys = []
                for name in side:
                    key = exercise_key(name)
                    if key not in stations:
                        raise SystemExit(f"{where}: superset exercise is not in the catalog ({name}).")
                    side_keys.append(key)
                    units.append(station_unit(stations[key]))
                keyed.append(side_keys)
            if len(set(units)) != 1:
                if ban_two_machine:
                    raise SystemExit(f"{where}: learned.md vetoes a two-machine superset.")
                raise SystemExit(f"{where}: superset must stay on one station.")
            for left_name in keyed[0]:
                for right_name in keyed[1]:
                    if frozenset((left_name, right_name)) in vetoes:
                        raise SystemExit(f"{where}: learned.md vetoes this superset.")
            if not same_whitelist_row(keyed[0], keyed[1], whitelist):
                raise SystemExit(f"{where}: superset is not on the closed whitelist.")
            pairs += 1
            if pairs > 1:
                raise SystemExit(f"{where}: only one superset is allowed in a session.")
            index += 2
            continue
        index += 1


def superset_self_test():
    stations = load_stations()
    whitelist = load_whitelist()
    missing = [
        name for left, right in whitelist for name in left | right
        if name not in stations
    ]
    if missing:
        return [f"whitelist name is not in the catalog: {', '.join(sorted(set(missing)))}"]
    errors = []

    def pair(left, right, sets="4 x 10-15"):
        return [
            {"groups": [[name.strip()] for name in left.split(" OR ")], "ss": "down", "sets": sets, "hints": []},
            {"groups": [[name.strip()] for name in right.split(" OR ")], "ss": "up", "sets": sets, "hints": []},
        ]

    def expect_fail(built, snippet, vetoes=None, ban=False):
        try:
            check_supersets(built, "test", stations, whitelist, vetoes, ban)
        except SystemExit as err:
            if snippet not in str(err):
                errors.append(f"expected {snippet!r} in {err}")
            return
        errors.append(f"expected failure containing {snippet!r}")

    def expect_ok(built):
        try:
            check_supersets(built, "test", stations, whitelist, set(), False)
        except SystemExit as err:
            errors.append(f"valid pair was rejected: {err}")

    expect_ok(pair("Rope Pushdown", "Cable Curl"))
    expect_ok(pair("Rope Pushdown OR Straight-Bar Pushdown", "Rope Hammer Curl"))
    expect_fail(pair("Face Pull", "Cable Curl"), "whitelist")
    expect_fail(pair("Chest Supported Row", "Iso-Lateral Row"), "one station")
    expect_fail(pair("Rope Pushdown OR Seated Dip Machine", "Cable Curl"), "one station")
    expect_fail(
        pair("Rope Pushdown", "Cable Curl") + pair("Incline Dumbbell Press", "Incline Bench Rear Delt Raise"),
        "only one superset",
    )
    unequal = pair("Rope Pushdown", "Cable Curl")
    unequal[1]["sets"] = "3 x 10-15"
    expect_fail(unequal, "equal")
    _ban, vetoes = learned_superset_vetoes(
        "Never superset Rope Pushdown and Cable Curl.",
        stations,
    )
    expect_fail(pair("Rope Pushdown", "Cable Curl"), "vetoes this superset", vetoes)
    banned = pair("Chest Supported Row", "Leg Press")
    expect_fail(banned, "two-machine", ban=True)
    one_side = render_rows(1, pair("Rope Pushdown OR Straight-Bar Pushdown", "Cable Curl"), {})
    both_sides = render_rows(1, pair("Rope Pushdown OR Straight-Bar Pushdown", "Cable Curl OR Rope Hammer Curl"), {})
    if one_side.count('class="join">AND') != 1 or one_side.count('class="join">OR') != 1:
        errors.append("an OR on one side of a superset was drawn as another AND")
    if both_sides.count('class="join">AND') != 1 or both_sides.count('class="join">OR') != 2:
        errors.append("OR on both sides of a superset was not kept inside each side")
    if one_side.count('class="join">(</b>') != 1 or one_side.count('class="join">)</b>') != 1:
        errors.append("an OR beside AND was not grouped as (x OR y) AND z")
    if both_sides.count('class="join">(</b>') != 2 or both_sides.count('class="join">)</b>') != 2:
        errors.append("OR on both sides of a superset was not grouped as (x OR y) AND (z OR w)")
    plain = exercise_html([["Rope Pushdown"], ["Straight-Bar Pushdown"]], "OR", "")[0]
    if 'class="join">(</b>' in plain:
        errors.append("a plain OR was wrapped in parentheses")
    return errors


def pair_sets(left, right):
    if set_count(left) is None or set_count(right) is None or set_count(left) != set_count(right):
        raise SystemExit(f"Superset set counts must be equal ({left} vs {right}).")
    if left == right:
        return f"{left} each"
    return f"{left} · {right}"


def render_rows(day_no, rows, tables):
    check_supersets(rows, f"Day {day_no}")
    html_rows = []
    index = 0
    while index < len(rows):
        row = rows[index]
        nxt = rows[index + 1] if index + 1 < len(rows) else None
        if row["ss"] == "down" and nxt and nxt["ss"] == "up":
            left, right = side_names(row), side_names(nxt)
            names = left + right
            hints = ["Superset · do both"] + [hint for hint in row["hints"] + nxt["hints"] if hint]
            html_row = row_html(
                [left, right], "AND", hints, pair_sets(row["sets"], nxt["sets"]),
                popup_for(day_no, names, tables), slug(names),
            )
            ands = html_row.count('class="join">AND')
            ors = html_row.count('class="join">OR')
            expect_ors = max(0, len(left) - 1) + max(0, len(right) - 1)
            if ands != 1 or ors != expect_ors:
                raise SystemExit(
                    f"Day {day_no}: a superset is one AND, with OR only inside a side "
                    f"({ands} AND, {ors} OR)."
                )
            html_rows.append(html_row)
            index += 2
            continue
        names = [name for group in row["groups"] for name in group]
        html_rows.append(row_html(
            row["groups"], "OR", row["hints"], row["sets"],
            popup_for(day_no, names, tables), slug(names),
        ))
        index += 1
    return "\n".join(html_rows)


def render_choice_rows(rows, key_prefix):
    check_supersets(rows, key_prefix)
    html_rows = []
    for row in rows:
        names = [name for group in row["groups"] for name in group]
        html_rows.append(row_html(
            row["groups"], "OR", row["hints"], row["sets"], "",
            f"{key_prefix}:{slug(names)}", group=row.get("group", ""), track=False,
        ))
    return "\n".join(html_rows)


def focus_text(text):
    return html.escape(text.replace("•", "·").replace(" · ", " · "))


def choice_table(rows, key_prefix, eyebrow, lead):
    parts = []
    if eyebrow:
        parts.append(f'<p class="eyebrow">{html.escape(eyebrow)}</p>')
    if lead:
        parts.append(f'<p class="focus">{focus_text(lead)}</p>')
    parts.append(
        '<div class="table-wrap"><table><thead><tr>'
        "<th>Exercise</th><th>Sets &amp; reps</th></tr></thead><tbody>\n"
        f"{render_choice_rows(rows, key_prefix)}\n</tbody></table></div>"
    )
    return "".join(parts)


def bonus_present(plan):
    return any(plan.get(name) for name in ("bonus", "support", "coverage", "cardio", "optional"))


def render(plan, notes, person, slot):
    found = sections(notes)
    tables = exercise_rows(found.get("Exercise notes", ""))
    day_body = day_section(found)
    briefs = briefs_from(day_body)
    bonus_note = named_brief(notes, "Bonus")
    title_note = program_note(found)
    weeks = plan["weeks"]
    if not weeks:
        raise SystemExit("No weeks found in the gym file.")
    day_count = len(weeks[0]["days"])
    if any(len(week["days"]) != day_count for week in weeks):
        raise SystemExit("Each week needs the same number of days.")
    start_date, total_weeks = cycle_metadata(plan)
    feedback = feedback_prompts(found.get("Critical feedback", ""), weeks)

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
    if bonus_present(plan):
        day_buttons.append(
            '<button type="button" id="bonus-tab" aria-selected="false" data-bonus>'
            '<small>EXTRA</small>Bonus</button>'
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
                f'placeholder="Note for this day">{html.escape(feedback.get(f"{w_index}-{d_index}", ""))}</textarea></label>'
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

    bonus_rows = plan.get("bonus") or []
    if bonus_present(plan):
        heading = "Bonus" if any(plan.get(name) for name in ("bonus", "support", "coverage", "cardio")) else "Optional"
        if bonus_note:
            h2 = (
                f'<h2 class="noted"><span>{html.escape(heading)}</span>'
                + info_button(bonus_note, f"Note for {heading}")
                + "</h2>"
            )
        else:
            h2 = f"<h2>{html.escape(heading)}</h2>"
        blocks = []
        if bonus_rows:
            lead = plan.get("bonus_lead") or ""
            if not lead and any(row.get("group") for row in bonus_rows):
                lead = "Choose 1 from A, 1 from B, 1 from C"
            blocks.append(choice_table(bonus_rows, "bonus", "", lead))
        for name, eyebrow in (("support", "SUPPORT"), ("coverage", "COVERAGE"), ("cardio", "CARDIO")):
            rows = plan.get(name) or []
            if rows:
                blocks.append(choice_table(rows, name, eyebrow, plan.get(f"{name}_lead") or ""))
        if plan.get("optional"):
            blocks.append(choice_table(plan["optional"], "optional", "OPTIONAL", ""))
        note_box = (
            '<label class="day-note-wrap"><span>Note</span>'
            '<textarea class="day-note" data-day="bonus" '
            'placeholder="Note for this day"></textarea></label>'
        )
        panels.append(
            f'<section class="panel bonus-panel" data-panel="bonus" hidden>'
            f'<p class="eyebrow">BONUS</p>{h2}'
            + "".join(blocks)
            + f"{note_box}</section>"
        )

    page = TEMPLATE.read_text()
    replacements = {
        "{{TITLE}}": html.escape(title),
        "{{DESCRIPTION}}": html.escape(f"{nice}{apos}s personalized gym plan."),
        "{{H1_HTML}}": h1,
        "{{PERIOD}}": html.escape(period),
        "{{START_DATE}}": start_date,
        "{{WEEK_TOTAL}}": total_weeks,
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
    global ACTIVE_SUPERSETS
    failures = superset_self_test()
    if failures:
        print("superset publisher checks failed:\n  " + "\n  ".join(failures), file=sys.stderr)
        return 1
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
    stations = load_stations()
    learned_path = PLANNER / "people" / args.name.strip().casefold() / "learned.md"
    learned = learned_path.read_text(encoding="utf-8") if learned_path.is_file() else ""
    ban_two_machine, vetoes = learned_superset_vetoes(learned, stations)
    ACTIVE_SUPERSETS = (stations, load_whitelist(), vetoes, ban_two_machine)
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
    sys.exit(main() or 0)
