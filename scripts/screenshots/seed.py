#!/usr/bin/env python3
"""Seed a throwaway Deltos instance with synthetic data for screenshots.

Talks to a running server over its JSON API (no database access), creating a
small but realistic household: three accounts, four projects, labels, tasks in
every column, comments, shared expenses, one public invite link, a decided
decision and a rewards catalog.

Only the standard library is used, so any python3 works.

Usage:
    seed.py --base http://127.0.0.1:3998 --out /tmp/shots/state.json
"""

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request


class Session:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def req(self, method, path, body=None, expect=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.csrf:
            req.add_header("x-csrf-token", self.csrf)
        try:
            with self.opener.open(req) as res:
                status = res.status
                raw = res.read()
        except urllib.error.HTTPError as err:
            status = err.code
            raw = err.read()
        if expect is not None and status != expect:
            print(f"FAIL {method} {path}: {status} {raw[:300]!r}", file=sys.stderr)
            raise SystemExit(1)
        return json.loads(raw) if raw else {}

    def me(self):
        return self.req("GET", "/api/auth/me")["user"]["id"]


def day(offset):
    return time.strftime("%Y-%m-%d", time.localtime(time.time() + offset * 86400))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3998")
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-pass", default="screenshots-pass")
    ap.add_argument("--out", default="/tmp/deltos-shots-state.json")
    args = ap.parse_args()

    admin = Session(args.base)
    login = admin.req(
        "POST", "/api/auth/login", {"username": args.admin_user, "password": args.admin_pass}, 200
    )
    admin.csrf = login.get("csrfToken")
    admin_id = admin.me()

    uid = {args.admin_user: admin_id}
    for name, color in (("mar", "violet"), ("jordi", "emerald")):
        admin.req(
            "POST",
            "/api/users",
            {"username": name, "password": "Screenshots-pass1", "color": color, "role": "user"},
            201,
        )
    for user in admin.req("GET", "/api/users")["users"]:
        uid[user["username"]] = user["id"]

    sessions = {args.admin_user: admin}
    for name in ("mar", "jordi"):
        s = Session(args.base)
        s.csrf = s.req(
            "POST", "/api/auth/login", {"username": name, "password": "Screenshots-pass1"}, 200
        ).get("csrfToken")
        s.me()
        sessions[name] = s

    projects = {}
    for name in ("Casa", "Trabajo", "Viaje a Lisboa", "Huerto"):
        projects[name] = admin.req("POST", "/api/projects", {"name": name}, 201)["project"]["id"]
    for pid in projects.values():
        admin.req("PUT", f"/api/projects/{pid}/members", {"member_ids": [uid["mar"], uid["jordi"]]}, 200)

    labels = {}
    for name, color in (
        ("Admin", "slate"),
        ("Compras", "amber"),
        ("Dev", "sky"),
        ("Diseño", "violet"),
        ("Familia", "pink"),
        ("Urgente", "rose"),
    ):
        labels[name] = admin.req("POST", "/api/labels", {"name": name, "color": color}, 201)["label"]["id"]

    tasks = [
        ("Casa", "Pedir cita ITV", "alta", day(5), ["Admin"], "mar"),
        ("Casa", "Llamar al seguro del coche", "media", day(2), ["Admin", "Urgente"], "mar"),
        ("Casa", "Comprar bombillas para el recibidor", "baja", None, ["Compras"], args.admin_user),
        ("Casa", "Revisar presupuesto reforma baño", "alta", day(-1), ["Admin"], "jordi"),
        ("Trabajo", "Preparar presentación Q3", "alta", day(0), ["Diseño"], "jordi"),
        ("Trabajo", "Enviar factura de julio al cliente", "alta", day(1), ["Admin", "Urgente"], args.admin_user),
        ("Trabajo", "Corregir bug de inicio de sesión", "media", day(7), ["Dev", "Urgente"], "jordi"),
        ("Trabajo", "Actualizar CV", "baja", None, [], "mar"),
        ("Viaje a Lisboa", "Reservar hotel en Lisboa", "alta", day(12), ["Familia", "Compras"], "mar"),
        ("Viaje a Lisboa", "Sacar billetes de tren", "media", day(9), ["Compras"], args.admin_user),
        ("Viaje a Lisboa", "Hacer lista de restaurantes", "baja", None, ["Familia"], "jordi"),
        ("Huerto", "Comprar sustrato", "baja", None, ["Compras"], args.admin_user),
        ("Huerto", "Podar los tomates", "media", day(3), [], "mar"),
    ]
    ids = {}
    for project, title, priority, due, task_labels, assignee in tasks:
        body = {
            "project_id": projects[project],
            "title": title,
            "priority": priority,
            "labels": [labels[x] for x in task_labels],
            "assignee_id": uid[assignee],
        }
        if due:
            body["due_date"] = due
        ids[title] = admin.req("POST", "/api/tasks", body, 201)["task"]["id"]

    for who, title in (
        ("mar", "Podar los tomates"),
        ("jordi", "Sacar billetes de tren"),
        ("jordi", "Actualizar CV"),
        (args.admin_user, "Enviar factura de julio al cliente"),
        (args.admin_user, "Comprar bombillas para el recibidor"),
    ):
        sessions[who].req("POST", f"/api/tasks/{ids[title]}/move", {"column": "hecho", "position": 0}, 200)
    for title in ("Preparar presentación Q3", "Reservar hotel en Lisboa"):
        admin.req("POST", f"/api/tasks/{ids[title]}/move", {"column": "encurso", "position": 0}, 200)

    for who, text in (
        ("mar", "He pedido dos presupuestos, el jueves los comparamos."),
        ("jordi", "El proveedor del baño confirma stock."),
    ):
        sessions[who].req(
            "POST", f"/api/tasks/{ids['Revisar presupuesto reforma baño']}/comments", {"body": text}, 201
        )
    sessions["mar"].req(
        "POST",
        f"/api/tasks/{ids['Preparar presentación Q3']}/comments",
        {"body": "Faltan las cifras de agosto, las meto mañana."},
        201,
    )

    admin.req(
        "PUT",
        "/api/settings/server",
        {
            "backup_enabled": True,
            "backup_retention_days": 14,
            "max_attachments_per_task": 10,
            "plugin_expenses_enabled": True,
            "archive_after_days": 30,
        },
        200,
    )

    expenses = {}
    for title, amount, payer, shares in (
        ("Cena del viaje", 6000, args.admin_user, [("admin", 2000), ("mar", 2000), ("jordi", 2000)]),
        ("Gasolina a Lisboa", 4500, "jordi", [("jordi", 2250), ("mar", 2250)]),
        ("Compra del súper", 3275, "mar", [("mar", 1638), ("admin", 1637)]),
        ("Entradas del museo", 2400, "mar", [("mar", 800), ("jordi", 800), ("admin", 800)]),
    ):
        shares_body = [{"user_id": uid[u], "share_cents": c} for u, c in shares]
        body = {
            "title": title,
            "amount_cents": amount,
            "payer_id": uid[payer],
            "shares": shares_body,
            "spent_at": int(time.time() * 1000),
        }
        expenses[title] = admin.req("POST", "/api/expenses", body, 201)["expense"]["id"]

    invite = admin.req(
        "POST",
        "/api/invite/create",
        {
            "invite_name": "Ana",
            "share_cents": 2000,
            "expense_id": expenses["Cena del viaje"],
            "notes": "Tu parte de la cena",
        },
        201,
    )["invite"]

    decision = admin.req(
        "POST",
        "/api/decisions",
        {
            "project_id": projects["Casa"],
            "title": "¿Cambiamos el sofá del salón?",
            "description": "El actual se hunde por el lado de la ventana. Valoramos arreglarlo o comprar uno nuevo.",
        },
        201,
    )["decision"]["id"]
    solutions = []
    for title in ("Comprar uno nuevo en la tienda del barrio", "Reparar el actual con un tapicero"):
        solutions.append(
            admin.req("POST", f"/api/decisions/{decision}/solutions", {"title": title}, 201)["solution"]["id"]
        )
    sessions["mar"].req("PUT", f"/api/decisions/{decision}/vote", {"solution_id": solutions[1]}, 200)
    sessions["jordi"].req("PUT", f"/api/decisions/{decision}/vote", {"solution_id": solutions[1]}, 200)
    admin.req("POST", f"/api/decisions/{decision}/choose", {"solution_id": solutions[1]}, 200)

    admin.req("POST", "/api/rewards", {"title": "Pizza del viernes", "emoji": "🍕", "cost": 25}, 201)
    admin.req("POST", "/api/rewards", {"title": "Mañana sin despertador", "emoji": "😴", "cost": 60}, 201)

    state = {"invite_token": invite["token"], "admin_user": args.admin_user, "admin_pass": args.admin_pass}
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    print(f"seeded {args.base}, state at {args.out}")


if __name__ == "__main__":
    main()
