"""Contract test for the forum backend.

Run the backend first (any mode) with admin-key=test-admin-key-123, e.g.:

    printf 'port=8321\nadmin-key=test-admin-key-123\n' > nocoords.properties
    java -jar ../dist/nocoords-backend-1.0.0.jar &

then:  python3 api.test.py
Solves real proof-of-work, so it takes a few seconds.
"""
import hashlib, json, urllib.request, urllib.error

BASE = "http://127.0.0.1:8321/api"
passed = failed = 0

def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name} {detail}")

def req(method, path, body=None, headers=None, ctype="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        r.add_header("Content-Type", ctype)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b"null"), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), e.headers

def solve():
    st, ch, _ = req("GET", "/challenge")
    assert st == 200, ch
    seed, diff = ch["seed"], ch["difficulty"]
    nonce = 0
    while True:
        h = hashlib.sha256(f"{seed}:{nonce}".encode()).digest()
        bits = 0
        for b in h:
            if b == 0:
                bits += 8; continue
            bits += 8 - b.bit_length()
            break
        if bits >= diff:
            return {"seed": seed, "nonce": nonce}
        nonce += 1

# boards
st, boards, hdrs = req("GET", "/boards")
check("boards 200 with 5 boards", st == 200 and len(boards) == 5, boards)
check("no Set-Cookie", hdrs.get("Set-Cookie") is None)
check("nosniff header", hdrs.get("X-Content-Type-Options") == "nosniff")
check("no-referrer header", hdrs.get("Referrer-Policy") == "no-referrer")
check("CORS header", hdrs.get("Access-Control-Allow-Origin") == "*")

# create thread
proof = solve()
st, out, _ = req("POST", "/threads", {"boardId": "anarchy", "subject": "First real thread", "body": "posted through the real backend §c§lred§r test", "proof": proof})
check("create thread", st == 200 and out.get("threadId"), out)
tid = out["threadId"]
op_poster = out.get("posterId")
check("thread returns posterId", isinstance(op_poster, str) and len(op_poster) == 6, out)

# proof replay must fail
st, out2, _ = req("POST", "/threads", {"boardId": "anarchy", "subject": "replay", "body": "x", "proof": proof})
check("seed is single-use", st == 403, out2)

# bad proof
st, out2, _ = req("POST", "/threads", {"boardId": "anarchy", "subject": "bad", "body": "x", "proof": {"seed": "deadbeef", "nonce": 1}})
check("bad proof rejected", st == 403, out2)

# reply
st, out2, _ = req("POST", f"/threads/{tid}/posts", {"body": ">>p1\nsame ip, same thread, same id expected", "proof": solve()})
check("create reply", st == 200 and out2.get("postId"), out2)
check("reply posterId matches OP (same ip+thread)", out2.get("posterId") == op_poster, out2)

# get thread
st, data, _ = req("GET", f"/threads/{tid}")
check("get thread", st == 200 and data["thread"]["id"] == tid, data)
check("two posts", len(data["posts"]) == 2, data)
check("you matches posterId", data.get("you") == op_poster, data)
check("bumpedAt advanced", data["thread"]["bumpedAt"] >= data["thread"]["createdAt"])

# listings + excerpt
st, threads, _ = req("GET", "/boards/anarchy/threads")
check("board threads listed", st == 200 and any(t["id"] == tid for t in threads), threads)
t = next(t for t in threads if t["id"] == tid)
check("excerpt strips format codes", "§" not in t["excerpt"] and "red" in t["excerpt"], t)
check("replyCount", t["replyCount"] == 1, t)

# sealed + book excerpts
st, out2, _ = req("POST", "/threads", {"boardId": "b", "subject": "sealed", "body": "nc1.abcdef", "proof": solve()})
st, out3, _ = req("POST", "/threads", {"boardId": "b", "subject": "book", "body": "/book My Tale\npage one\n---\npage two", "proof": solve()})
st, threads, _ = req("GET", "/boards/b/threads")
ex = {t["subject"]: t["excerpt"] for t in threads}
check("sealed excerpt", ex.get("sealed") == "[sealed post]", ex)
check("book excerpt", ex.get("book") == "[book] My Tale", ex)

# validation
st, out2, _ = req("POST", "/threads", {"boardId": "nope", "subject": "s", "body": "b", "proof": solve()})
check("unknown board 400", st == 400, out2)
st, out2, _ = req("POST", "/threads", {"boardId": "b", "subject": "s", "body": "x" * 8001, "proof": solve()})
check("oversize body 400", st == 400, out2)
st, out2, _ = req("POST", "/threads", {"boardId": "b", "subject": "x" * 121, "body": "b", "proof": solve()})
check("oversize subject 400", st == 400, out2)
st, out2, _ = req("POST", f"/threads/tNOPE/posts", {"body": "hi", "proof": solve()})
check("reply to missing thread 404", st == 404, out2)
st, out2, _ = req("POST", "/threads", {"boardId": "b", "subject": "s", "body": "b", "proof": solve()}, ctype="multipart/form-data")
check("multipart rejected 415", st == 415, out2)

# admin removal
pid = data["posts"][1]["id"]
st, out2, _ = req("DELETE", f"/posts/{pid}")
check("delete without key 403", st == 403, out2)
st, out2, _ = req("DELETE", f"/posts/{pid}", headers={"X-Admin-Key": "wrong"})
check("delete wrong key 403", st == 403, out2)
st, out2, _ = req("DELETE", f"/posts/{pid}", headers={"X-Admin-Key": "test-admin-key-123"})
check("delete with key", st == 200 and out2.get("removed") is True, out2)
st, data, _ = req("GET", f"/threads/{tid}")
gone = data["posts"][1]
check("post blanked", gone["removed"] is True and gone["body"] == "", gone)

# removed OP shows [removed] in listing
st, out2, _ = req("GET", f"/threads/{tid}")
op_id = out2["posts"][0]["id"]
req("DELETE", f"/posts/{op_id}", headers={"X-Admin-Key": "test-admin-key-123"})
st, threads, _ = req("GET", "/boards/anarchy/threads")
t = next(t for t in threads if t["id"] == tid)
check("removed OP excerpt", t["excerpt"] == "[removed]", t)

# preflight
r = urllib.request.Request(BASE + "/threads", method="OPTIONS")
with urllib.request.urlopen(r) as resp:
    h = resp.headers
    check("preflight 204", resp.status == 204)
    check("preflight methods", "DELETE" in h.get("Access-Control-Allow-Methods", ""), h)
    check("preflight headers", "X-Admin-Key" in h.get("Access-Control-Allow-Headers", ""), h)

# malformed json
st, out2, _ = req("POST", "/threads", None)
r = urllib.request.Request(BASE + "/threads", data=b"{not json", method="POST")
r.add_header("Content-Type", "application/json")
try:
    urllib.request.urlopen(r)
    check("malformed json 400", False)
except urllib.error.HTTPError as e:
    check("malformed json 400", e.code == 400)

# 404s
st, out2, _ = req("GET", "/nope")
check("unknown route 404", st == 404, out2)
st, out2, _ = req("GET", "/threads/tNOPE")
check("missing thread 404", st == 404, out2)

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
