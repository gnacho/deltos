import sys
from playwright.sync_api import sync_playwright

URL = "file:///mnt/agents/output/taskdeck-mockup/index.html"
errors = []

def run(browser):
    # ---------- MÓVIL 390x844 ----------
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"[mobile:{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[mobile:pageerror] {e}"))
    page.goto(URL)
    page.wait_for_timeout(600)

    toggle = page.locator("#filters-toggle")
    panel = page.locator("#filters-panel")
    assert toggle.is_visible(), "botón Filtros no visible en móvil"
    box = panel.bounding_box()
    assert box is None or box["height"] < 2, f"panel visible por defecto en móvil (h={box and box['height']})"
    assert toggle.get_attribute("aria-expanded") == "false"
    assert "Filtros" in toggle.inner_text()
    print("mobile: panel colapsado por defecto OK")

    # la primera tarjeta móvil debe estar cerca del top (no empujada)
    card = page.locator("#mobile-list .card").first
    print("mobile: primera tarjeta y=", card.bounding_box()["y"])

    # desplegar
    toggle.click()
    page.wait_for_timeout(500)
    box = panel.bounding_box()
    assert box and box["height"] > 50, "panel no se despliega"
    assert toggle.get_attribute("aria-expanded") == "true"
    print("mobile: despliegue OK, aria-expanded=true, h=", box["height"])
    page.screenshot(path="/mnt/agents/output/taskdeck-mockup/_shot_mobile_expanded.png")

    # aplicar 2 filtros: proyecto Casa + prioridad Alta
    page.locator('[data-fgroup="projects"][data-fvalue="casa"]').click()
    page.locator('[data-fgroup="priorities"][data-fvalue="alta"]').click()
    page.wait_for_timeout(200)
    txt = page.locator("#filters-toggle").inner_text()
    assert "2" in txt, f"contador no actualizado: {txt!r}"
    print("mobile: contador OK ->", repr(txt))
    # filtrado aplicado: 2 tarjetas 'nuevo' de casa alta -> t1 (Pedir cita ITV)
    assert page.locator("#mobile-list .card").count() == 1

    # colapsar con filtros activos
    page.locator("#filters-toggle").click()
    page.wait_for_timeout(500)
    box = panel.bounding_box()
    assert box is None or box["height"] < 2, "panel no se colapsa"
    t2 = page.locator("#filters-toggle").inner_text()
    assert "· 2" in t2, f"sin evidencia visible: {t2!r}"
    print("mobile: colapsado con evidencia OK ->", repr(t2))
    page.screenshot(path="/mnt/agents/output/taskdeck-mockup/_shot_mobile_collapsed_active.png")

    # limpiar desde panel desplegado
    page.locator("#filters-toggle").click()
    page.wait_for_timeout(400)
    page.locator("#clear-filters").click()
    page.wait_for_timeout(200)
    t3 = page.locator("#filters-toggle").inner_text().strip()
    assert t3 == "Filtros", f"tras limpiar: {t3!r}"
    print("mobile: limpiar OK ->", repr(t3))

    # scroll no roto tras colapsar
    page.locator("#filters-toggle").click()  # colapsar
    page.wait_for_timeout(300)
    page.mouse.wheel(0, 800)
    page.wait_for_timeout(200)
    sy = page.evaluate("window.scrollY")
    assert sy > 100, f"scroll roto (scrollY={sy})"
    print("mobile: scroll OK, scrollY=", sy)
    # el estado expandido tampoco rompe el scroll
    page.evaluate("window.scrollTo(0,0)")
    page.locator("#filters-toggle").click()  # expandir
    page.wait_for_timeout(400)
    page.mouse.wheel(0, 800)
    page.wait_for_timeout(200)
    assert page.evaluate("window.scrollY") > 100, "scroll roto con panel expandido"
    print("mobile: scroll con panel expandido OK")
    ctx.close()

    # ---------- DESKTOP 1440x900 ----------
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    d = ctx2.new_page()
    d.on("console", lambda m: errors.append(f"[desktop:{m.type}] {m.text}") if m.type == "error" else None)
    d.on("pageerror", lambda e: errors.append(f"[desktop:pageerror] {e}"))
    d.goto(URL)
    d.wait_for_timeout(600)
    assert not d.locator("#filters-toggle").is_visible(), "botón Filtros visible en desktop"
    box = d.locator("#filters-panel").bounding_box()
    assert box and box["height"] > 50, "panel no visible en desktop"
    # filtrar en desktop
    d.locator('[data-fgroup="people"][data-fvalue="mar"]').click()
    d.wait_for_timeout(200)
    assert d.locator("#board .card").count() == 7, "filtro desktop no aplica"
    d.locator("#clear-filters").click()
    d.wait_for_timeout(200)
    assert d.locator("#board .card").count() == 15
    print("desktop: panel siempre visible y funcional OK")
    ctx2.close()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    run(browser)
    browser.close()

if errors:
    print("ERRORES DE CONSOLA:")
    for e in errors: print(" ", e)
    sys.exit(1)
print("TODO OK · 0 errores de consola")
