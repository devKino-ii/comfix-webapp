#!/usr/bin/env python3
"""ComFix demo: the full MVP flow in the terminal. Standard library only (Python 3.8+).

  python comfix_demo.py           interactive menu (citizen and office views)
  python comfix_demo.py --tour    guided walkthrough, one Enter per step (best for presenting)
  python comfix_demo.py --reset   restore the seeded data

Data is saved to comfix_data.json next to this file (not in --tour mode).
Pins are (lat, lng) pairs. The real app would fill them from a Google Maps click.
"""
import json, math, os, re, sys, time

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfix_data.json")
STATUSES = ["New", "Verified", "In progress", "Resolved"]
CATEGORIES = ["Flooding", "Road damage", "Streetlight", "Garbage", "Safety hazard"]
DANGER = ["wire", "electric", "fire", "child", "playground", "collapse", "flood", "gas"]
STOP = set("a an the of on at by in to for and is are was were it its this that with near again "
           "very not up out from my our there here have has be been just so but or as i we you beside".split())
THRESH, NEAR_M, FAR_M = 0.35, 150, 450  # join score; "same spot" and "too far apart" in metres
PERSIST = True

# (id, category, severity, text, created hour, status, pin or None)
SEED = [
    (1, "Flooding", 4, "Street flooded near the market, water knee deep", -5, "Verified", (14.514134, 121.235086)),
    (2, "Flooding", 3, "Market road flooding again, cars stuck", -3, "Verified", (14.514834, 121.235186)),
    (3, "Road damage", 3, "Large pothole on the main road near the school, motorbikes swerving", -30, "New", (14.517134, 121.242086)),
    (4, "Road damage", 2, "Deep pothole beside the school gate", -20, "New", (14.517234, 121.242286)),
    (5, "Streetlight", 3, "Streetlight out on the bridge, very dark at night", -48, "New", (14.511134, 121.244086)),
    (6, "Garbage", 2, "Uncollected garbage piling up at the corner", -72, "Verified", None),
    (7, "Safety hazard", 5, "Exposed live wire hanging low near the playground", -1, "In progress", (14.520134, 121.233086)),
    (8, "Garbage", 2, "Garbage not collected for a week, bad smell", -96, "Verified", None),
    (9, "Streetlight", 2, "Bridge lamp broken, dark walkway", -24, "New", (14.511234, 121.244186)),
    (10, "Flooding", 3, "Drainage clogged, flooded street by the market", -2, "Verified", (14.514534, 121.235686)),
    (11, "Road damage", 2, "Fallen branch blocking the lane", -200, "Resolved", (14.521134, 121.246086)),
    (12, "Flooding", 3, "Overflowing drain on the school road", -150, "Resolved", (14.522134, 121.244086)),
]


# ---------- engine (pure functions) ----------
def stem(w):
    if len(w) > 4:
        w = re.sub(r"s$", "", re.sub(r"(ing|ed)$", "", w))
    return w


def tokens(text):
    return [stem(w) for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2 and w not in STOP]


def vec(toks, idf):
    v = {}
    for w in toks:
        v[w] = v.get(w, 0) + 1
    return {w: c * idf(w) for w, c in v.items()}


def corpus(reports):
    docs = [tokens(r["text"]) for r in reports]
    df = {}
    for d in docs:
        for w in set(d):
            df[w] = df.get(w, 0) + 1
    n = len(docs)
    idf = lambda w: math.log((n + 1) / (df.get(w, 0) + 1)) + 1
    return idf, [vec(d, idf) for d in docs]


def cosine(a, b):
    dot = sum(x * b.get(w, 0) for w, x in a.items())
    na, nb = math.sqrt(sum(x * x for x in a.values())), math.sqrt(sum(x * x for x in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def metres(p, q):
    dy = (q[0] - p[0]) * 110540
    dx = (q[1] - p[1]) * 111320 * math.cos(math.radians(p[0]))
    return math.hypot(dx, dy)


def pair_score(a, b, va, vb):
    """Returns (score, threshold). Text similarity, plus category and distance bonuses."""
    s = cosine(va, vb) + (0.15 if a["cat"] == b["cat"] else 0)
    if a["pin"] and b["pin"]:
        d = metres(a["pin"], b["pin"])
        if d > FAR_M:
            return 0.0, THRESH
        return s + (0.10 if d <= NEAR_M else 0), THRESH
    return s, THRESH - 0.05  # no pin on one side: no distance bonus, slightly lower bar


def make_group(rs, now):
    rs = sorted(rs, key=lambda r: r["t"])
    n, sev, age = len(rs), max(r["sev"] for r in rs), now - rs[0]["t"]
    text = " ".join(r["text"] for r in rs).lower()
    f = dict(sev=sev, rep=1 + math.log2(n), age=1 + min(age, 72) / 144,
             dng=1 + 0.3 * min(2, sum(k in text for k in DANGER)))
    return dict(rs=rs, n=n, sev=sev, age=age, f=f, pr=f["sev"] * f["rep"] * f["age"] * f["dng"],
                st=min(STATUSES.index(r["status"]) for r in rs), title=rs[0]["text"],
                cat=rs[0]["cat"], pin=next((r["pin"] for r in rs if r["pin"]), None))


def groups(reports, now):
    idf, vs = corpus(reports)
    parent = list(range(len(reports)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(reports)):
        for j in range(i + 1, len(reports)):
            s, th = pair_score(reports[i], reports[j], vs[i], vs[j])
            if s >= th:
                parent[find(i)] = find(j)
    buckets = {}
    for i, r in enumerate(reports):
        buckets.setdefault(find(i), []).append(r)
    return [make_group(rs, now) for rs in buckets.values()]


def similar(db, draft):
    rs = db["reports"]
    idf, vs = corpus(rs)
    dv = vec(tokens(draft["text"]), idf)
    hit = {r["id"] for i, r in enumerate(rs) if (lambda p: p[0] >= p[1])(pair_score(draft, r, dv, vs[i]))}
    return [g for g in groups(rs, db["now"]) if any(r["id"] in hit for r in g["rs"])]


def submit(db, draft):
    r = dict(id=db["next_id"], cat=draft["cat"], sev=draft["sev"], text=draft["text"],
             t=db["now"], status="New", pin=draft["pin"], mine=True, by=draft.get("by"))
    db["next_id"] += 1
    db["reports"].append(r)
    g = next(g for g in groups(db["reports"], db["now"]) if r in g["rs"])
    others, reopened = [x for x in g["rs"] if x is not r], False
    if others:
        m = min(STATUSES.index(x["status"]) for x in others)
        if m == 3:  # A new report reopens a fully resolved report group.
            reopened = True
            for x in others:
                x["status"] = "New"
                x.pop("resolvedAt", None)
        else:
            r["status"] = STATUSES[m]
    save(db)
    return r, g, reopened


# ---------- storage ----------
def fresh():
    return {"now": 0, "next_id": 13, "reports": [
        dict(id=i, cat=c, sev=s, text=x, t=t, status=st, pin=list(p) if p else None, mine=False)
        for i, c, s, x, t, st, p in SEED]}


def load():
    if "--reset" in sys.argv or not os.path.exists(DB_FILE):
        db = fresh()
        save(db)
        return db
    with open(DB_FILE) as f:
        return json.load(f)


def save(db):
    if PERSIST:
        with open(DB_FILE, "w") as f:
            json.dump(db, f, indent=1)


# ---------- views ----------
def rule(c="-"): print(c * 74)
def head(s): print(); rule("="); print(s); rule("=")
def n_rep(n): return f"{n} report" + ("" if n == 1 else "s")
def where(p): return f"pin {p[0]:.4f}, {p[1]:.4f}" if p else "no pin"
def bar(v, mx, w=24): return "#" * max(1, round(w * v / mx))


def num(prompt, lo, hi, default):
    s = input(f"{prompt} [{lo}-{hi}, Enter = {default}]: ").strip()
    return int(s) if s.isdigit() and lo <= int(s) <= hi else default


def show_reports(db, sort="severity"):
    gs = [g for g in groups(db["reports"], db["now"]) if g["st"] < 3]
    gs.sort(key=(lambda g: (-g["sev"], -g["n"])) if sort == "severity" else (lambda g: (-g["n"], -g["sev"])))
    head(f"CITIZEN  Reports (open issues), sorted by {sort}")
    for i, g in enumerate(gs, 1):
        print(f"{i:>2}. [{STATUSES[g['st']]:<11}] severity {g['sev']}  {n_rep(g['n']):<10} {g['title']}")
        print(f"      {where(g['pin'])}")


def show_resolved(db):
    head("CITIZEN  Resolved")
    gs = [g for g in groups(db["reports"], db["now"]) if g["st"] == 3]
    for g in gs:
        print(f" - {g['title']}  ({n_rep(g['n'])})")
    if not gs:
        print("  Nothing resolved yet.")


def show_similar(db, draft):
    hits = similar(db, draft)
    if not hits:
        print("  No similar report yet. This will be a new report group.")
        return
    print("  Already reported nearby:")
    for g in hits[:2]:
        print(f'   - "{g["title"]}" ({n_rep(g["n"])}, {STATUSES[g["st"]]})')
    print("  Submitting adds yours to that group, so the office sees one report.")


def file_report(db):
    head("CITIZEN  New report")
    for i, c in enumerate(CATEGORIES, 1):
        print(f"  {i}. {c}")
    cat = CATEGORIES[num("Category", 1, 5, 1) - 1]
    sev = num("How serious (5 = dangerous now)", 1, 5, 3)
    pin = None
    try:
        la, ln = (float(x) for x in input("Pin (optional, 'lat,lng' from the map, Enter to skip): ").split(","))
        pin = [la, ln]
    except ValueError:
        pass
    text = input("What is happening? ").strip()
    if len(text) < 8:
        print("  Please describe the problem in a few words.")
        return
    draft = dict(cat=cat, sev=sev, text=text, pin=pin)
    show_similar(db, draft)
    if input("Submit? [Y/n]: ").strip().lower() == "n":
        return
    r, g, reopened = submit(db, draft)
    print(f"\n  Ticket CF-{r['id']:03d} filed. " + (f"Grouped with {g['n'] - 1} similar, so the office sees one report."
          if g["n"] > 1 else "No similar reports yet: this is a new report group."))
    if reopened:
        print("  A resolved report was reopened.")


def office_list(db):
    gs = sorted([g for g in groups(db["reports"], db["now"]) if g["st"] < 3], key=lambda g: -g["pr"])
    mx = max([g["pr"] for g in gs] or [1])
    head("OFFICE  Ranked reports")
    for i, g in enumerate(gs, 1):
        f = g["f"]
        print(f"{i:>2}. {g['pr']:5.1f} {bar(g['pr'], mx)}\n    {g['title']}")
        print(f"    {g['cat']}, {n_rep(g['n'])}, {g['age']:.0f}h old, {STATUSES[g['st']]}, {where(g['pin'])}")
        print(f"    severity {f['sev']} x reports {f['rep']:.2f} x age {f['age']:.2f} x danger words {f['dng']:.1f}")
    done = sum(1 for g in groups(db["reports"], db["now"]) if g["st"] == 3)
    print(f"\n  {done} resolved report group(s) not shown.")
    return gs


def set_status(g, status, db):
    for r in g["rs"]:
        if status == "Resolved" and r["status"] != "Resolved":
            r["resolvedAt"] = time.time()
        elif status != "Resolved":
            r.pop("resolvedAt", None)
        r["status"] = status
    save(db)


def change_status(db):
    gs = office_list(db)
    k = num("Report number", 1, max(1, len(gs)), 0) if gs else 0
    if not k:
        return
    for i, s in enumerate(STATUSES, 1):
        print(f"  {i}. {s}")
    s = num("New status", 1, 4, 0)
    if s:
        set_status(gs[k - 1], STATUSES[s - 1], db)
        print(f"  Set to {STATUSES[s - 1]}.")


def office_map(db):
    head("OFFICE  Map pins (the real app shows these on Google Maps)")
    gs = [g for g in groups(db["reports"], db["now"]) if g["st"] < 3]
    pinned = [g for g in gs if g["pin"]]
    for g in pinned:
        print(f" {g['pin'][0]:.4f}, {g['pin'][1]:.4f}  [{STATUSES[g['st']]:<11}] {n_rep(g['n'])}: {g['title']}")
    print(f"\n  {len(pinned)} of {len(gs)} open report groups have a pin.")


# ---------- guided tour ----------
def tour(db):
    pause = lambda m: input(f"\n  [Enter] {m} ")
    head("STEP 1  The office opens one ranked list")
    office_list(db)
    pause("next: a resident starts a report")
    d = dict(cat="Flooding", sev=3, text="Street flooding near the market, knee deep", pin=[10.0022, 10.0033])
    head("STEP 2  A resident types a report")
    print(f"  Category: Flooding   Severity: 3   Pin: dropped on the map\n  Text: {d['text']}")
    show_similar(db, d)
    pause("next: submit it")
    r, g, _ = submit(db, d)
    head("STEP 3  Submitted")
    print(f"  Ticket CF-{r['id']:03d} filed. Grouped with {g['n'] - 1} similar reports, so the office sees one report.")
    pause("next: the office view again")
    office_list(db)
    pause("next: the office starts work on the flooding report")
    set_status(g, "In progress", db)
    head("STEP 4  Status changed")
    show_reports(db, "reports")
    pause("next: six hours pass")
    db["now"] += 6
    office_list(db)
    pause("next: the flooding report is fixed")
    set_status(g, "Resolved", db)
    show_resolved(db)
    pause("next: it floods again")
    d2 = dict(cat="Flooding", sev=3, text="Market road flooded again after the rain", pin=[10.0023, 10.0032])
    head("STEP 5  A new report on a resolved issue")
    show_similar(db, d2)
    _, g2, reopened = submit(db, d2)
    print("  The report was reopened." if reopened else "  Filed as a separate report group.")
    office_list(db)
    print("\n  End of tour.")


MENU = """
CITIZEN                          OFFICE
 1  Reports (open issues)         4  Ranked reports
 2  Resolved                      5  Change a report's status
 3  New report                    6  Map pins
                                  7  Advance 6 hours
 0  Quit"""


def main():
    global PERSIST
    if "--tour" in sys.argv:
        PERSIST = False
        return tour(fresh())
    db = load()
    while True:
        print(MENU)
        c = input("> ").strip()
        if c == "0":
            return
        if c == "1":
            show_reports(db, "reports" if input("Sort by (s)everity or (n)umber of reports [s]: ").lower().startswith("n") else "severity")
        elif c == "2": show_resolved(db)
        elif c == "3": file_report(db)
        elif c == "4": office_list(db)
        elif c == "5": change_status(db)
        elif c == "6": office_map(db)
        elif c == "7":
            db["now"] += 6
            save(db)
            print("  Six hours later.")


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("\nBye.")
