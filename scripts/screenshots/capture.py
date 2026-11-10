#!/usr/bin/env python3
"""Capture the screenshots used by the README and the landing.

Requires Playwright for Python (`pip install playwright && playwright install
chromium`). Logs in against the instance seeded by seed.py and writes one PNG
per subject, language and theme at 1440x900 with a 2x scale factor.

Subjects: board, casa, viaje, trabajo, expenses, decisions, rewards, settings,
task (task modal, details tab) and invite (public invite page).

Usage:
    capture.py --base http://127.0.0.1:3998 --state /tmp/shots/state.json --out /tmp/shots
"""

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


def shot(page, out, lang, theme, name):
    page.wait_for_timeout(600)
    page.screenshot(path=str(Path(out) / f"{lang}-{theme}-{name}.png"))
    print(f"captured {lang} {theme} {name}")


def capture(browser, base, out, lang, theme, invite_token, user, password):
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        device_scale_factor=2,
        color_scheme=theme,
        locale="es-ES" if lang == "es" else "en-US",
    )
    page = ctx.new_page()
    page.add_init_script(f"localStorage.setItem('deltos-theme','{theme}')")

    login = ctx.request.post(base + "/api/auth/login", data={"username": user, "password": password})
    if not login.ok:
        raise SystemExit(f"login failed: {login.status} {login.text()[:200]}")
    csrf = login.json().get("csrfToken")
    if lang == "en":
        ctx.request.put(
            base + "/api/auth/profile",
            data={"language": "en"},
            headers={"x-csrf-token": csrf},
        )

    page.goto(base + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(1800)
    page.add_style_tag(content="*,*::before,*::after{transition:none!important;animation:none!important}")
    shot(page, out, lang, theme, "board")

    for name, label in (("casa", "Casa"), ("viaje", "Viaje a Lisboa"), ("trabajo", "Trabajo")):
        link = page.locator("nav a, aside a").filter(has_text=label).first
        if link.count() == 0:
            print(f"missing project link: {label}")
            continue
        link.click()
        page.wait_for_timeout(800)
        shot(page, out, lang, theme, name)

    for name, path in (("expenses", "/expenses"), ("decisions", "/decisions")):
        page.goto(base + path, wait_until="domcontentloaded")
        page.wait_for_timeout(1000)
        shot(page, out, lang, theme, name)

    page.goto(base + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(1000)
    badge = page.locator("header button").filter(has_text=re.compile(r"^\d+")).first
    if badge.count():
        badge.click()
        page.wait_for_timeout(800)
        shot(page, out, lang, theme, "rewards")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    else:
        print("points badge not found")

    page.goto(base + "/settings", wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    shot(page, out, lang, theme, "settings")

    page.goto(base + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(1000)
    card = page.locator("[data-task]").first
    if card.count():
        card.click()
        page.wait_for_timeout(700)
        tab = page.get_by_role("tab").filter(has_text=re.compile("Detalles|Details")).first
        if tab.count():
            tab.click()
            page.wait_for_timeout(500)
        shot(page, out, lang, theme, "task")
    else:
        print("task card not found")

    page.goto(base + "/invite/" + invite_token, wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    shot(page, out, lang, theme, "invite")
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3998")
    ap.add_argument("--state", default="/tmp/deltos-shots-state.json")
    ap.add_argument("--out", default="/tmp/deltos-shots")
    args = ap.parse_args()

    state = json.loads(Path(args.state).read_text(encoding="utf-8"))
    Path(args.out).mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for lang in ("es", "en"):
            for theme in ("light", "dark"):
                capture(
                    browser,
                    args.base,
                    args.out,
                    lang,
                    theme,
                    state["invite_token"],
                    state.get("admin_user", "admin"),
                    state.get("admin_pass", "screenshots-pass"),
                )
        browser.close()
    print(f"done, PNGs in {args.out}")


if __name__ == "__main__":
    main()
